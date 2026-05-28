import { createId, insertEvent, schema, type DbClient } from "@habit-gamba/db";
import { and, asc, eq, lte } from "drizzle-orm";

export const RECURRING_MARKET_TIME_ZONE = "America/New_York";
export const ALL_DAYS_MASK = 0b1111111;
export const WEEKDAYS_MASK = 0b0111110;
export const DEFAULT_RECURRING_BATCH_LIMIT = 100;
export const MAX_RECURRING_BATCH_LIMIT = 1_000;

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type RecurringExecutor = DbClient | DbTransaction;
export type RecurringMarketSeries = typeof schema.recurringMarketSeries.$inferSelect;
export type RecurringMarket = typeof schema.markets.$inferSelect;
export type CreateRecurringMarketSeriesResult = {
  firstMarket: RecurringMarket | null;
  series: RecurringMarketSeries;
};
export type EndRecurringMarketSeriesResult = {
  series: RecurringMarketSeries;
};
export type RunRecurringMarketWorkerResult = {
  createdCount: number;
  createdMarketIds: string[];
  errors: Array<{ message: string; seriesId?: string }>;
};

export async function createRecurringMarketSeries(input: {
  creatorUserId: string;
  daysOfWeekMask: number;
  db: DbClient;
  endsOn?: string | null;
  marketId: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}): Promise<CreateRecurringMarketSeriesResult> {
  const now = input.now ?? new Date();
  const daysOfWeekMask = normalizeDaysOfWeekMask(input.daysOfWeekMask);
  const endsOn = normalizeOptionalDate(input.endsOn);
  const today = localDateKey(now);

  if (endsOn && endsOn < today) {
    throw new RangeError("endsOn must be today or later");
  }

  return input.db.transaction(async (tx) => {
    const market = await loadMarketForUpdate(tx, input.marketId);

    if (market.creatorUserId !== input.creatorUserId) {
      throw new Error("Only the market creator may schedule recurring markets");
    }

    if (market.status !== "draft") {
      throw new Error("Only draft markets can be scheduled as recurring");
    }

    if (market.recurringSeriesId) {
      throw new Error("Market already belongs to a recurring series");
    }

    const todayIsSelected = hasDay(daysOfWeekMask, localDayOfWeek(now));
    const firstCloseAt = closeAtForLocalDate(today);
    const shouldOpenToday = todayIsSelected && (!endsOn || today <= endsOn) && now < firstCloseAt;
    const firstDate = shouldOpenToday
      ? today
      : nextEligibleDateAfter(today, daysOfWeekMask, endsOn);
    const seriesId = createId();
    const nextOpenAt = shouldOpenToday || !firstDate ? null : openAtForLocalDate(firstDate);
    const metadata = input.metadata ?? {};
    const [series] = await tx
      .insert(schema.recurringMarketSeries)
      .values({
        creatorUserId: input.creatorUserId,
        daysOfWeekMask,
        description: market.description,
        endsOn,
        id: seriesId,
        metadata,
        nextOpenAt,
        sourceMarketId: market.id,
        title: market.title,
      })
      .returning();

    if (!series) {
      throw new Error("Failed to create recurring market series");
    }

    if (!shouldOpenToday) {
      const [updatedTemplate] = await tx
        .update(schema.markets)
        .set({
          metadata: mergeRecords(market.metadata, metadata),
          recurringSeriesId: series.id,
          updatedAt: now,
        })
        .where(eq(schema.markets.id, market.id))
        .returning();

      if (!updatedTemplate) {
        throw new Error("Failed to link recurring market template");
      }

      return { firstMarket: null, series };
    }

    const [firstMarket] = await tx
      .update(schema.markets)
      .set({
        closesAt: firstCloseAt,
        metadata: mergeRecords(market.metadata, metadata),
        openedAt: now,
        recurrenceDate: today,
        recurringSeriesId: series.id,
        status: "open",
        updatedAt: now,
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    if (!firstMarket) {
      throw new Error("Failed to open first recurring market");
    }

    await insertEvent({
      aggregateId: firstMarket.id,
      aggregateType: "market",
      db: input.db,
      occurredAt: now,
      payload: {
        marketId: firstMarket.id,
        recurrenceDate: today,
        recurringSeriesId: series.id,
        status: "open",
      },
      tx,
      type: "market.opened",
    });

    const nextDate = nextEligibleDateAfter(today, daysOfWeekMask, endsOn);
    const [updatedSeries] = await tx
      .update(schema.recurringMarketSeries)
      .set({
        nextOpenAt: nextDate ? openAtForLocalDate(nextDate) : null,
        updatedAt: now,
      })
      .where(eq(schema.recurringMarketSeries.id, series.id))
      .returning();

    return { firstMarket, series: updatedSeries ?? series };
  });
}

export async function endRecurringMarketSeries(input: {
  db: DbClient;
  endedByUserId: string;
  reason?: string | null;
  seriesId: string;
  now?: Date;
}): Promise<EndRecurringMarketSeriesResult> {
  const now = input.now ?? new Date();
  const [series] = await input.db
    .update(schema.recurringMarketSeries)
    .set({
      endedAt: now,
      endReason: input.reason?.trim() || null,
      nextOpenAt: null,
      status: "ended",
      updatedAt: now,
    })
    .where(eq(schema.recurringMarketSeries.id, input.seriesId))
    .returning();

  if (!series) {
    throw new Error("Recurring market series not found");
  }

  return { series };
}

export async function runRecurringMarketWorker(input: {
  db: DbClient;
  limit?: number;
  now?: Date;
}): Promise<RunRecurringMarketWorkerResult> {
  const limit = normalizeRecurringBatchLimit(input.limit);
  const createdMarketIds: string[] = [];
  const errors: RunRecurringMarketWorkerResult["errors"] = [];

  for (let index = 0; index < limit; index += 1) {
    let claimedSeriesId: string | undefined;

    try {
      const marketId = await input.db.transaction(async (tx) => {
        const claimed = await claimNextDueSeries({
          now: input.now ?? new Date(),
          tx,
        });

        if (!claimed) {
          return null;
        }

        claimedSeriesId = claimed.id;
        return createDueOccurrence({
          db: input.db,
          now: input.now ?? new Date(),
          series: claimed,
          tx,
        });
      });

      if (!marketId) {
        break;
      }

      createdMarketIds.push(marketId);
    } catch (error) {
      errors.push({
        ...(claimedSeriesId ? { seriesId: claimedSeriesId } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    createdCount: createdMarketIds.length,
    createdMarketIds,
    errors,
  };
}

export function normalizeRecurringBatchLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_RECURRING_BATCH_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("RECURRING_MARKET_BATCH_LIMIT must be a positive integer");
  }

  return Math.min(limit, MAX_RECURRING_BATCH_LIMIT);
}

export function normalizeDaysOfWeekMask(mask: number): number {
  if (!Number.isInteger(mask) || mask < 1 || mask > ALL_DAYS_MASK) {
    throw new RangeError("daysOfWeekMask must select at least one day");
  }

  return mask;
}

export function localDateKey(date: Date): string {
  const parts = dateParts(date);
  return formatDateKey(parts.year, parts.month, parts.day);
}

export function openAtForLocalDate(dateKey: string): Date {
  const parts = parseDateKey(dateKey);

  return zonedDateTimeToUtc({
    ...parts,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: RECURRING_MARKET_TIME_ZONE,
  });
}

export function closeAtForLocalDate(dateKey: string): Date {
  const parts = parseDateKey(dateKey);

  return zonedDateTimeToUtc({
    ...parts,
    hour: 23,
    minute: 59,
    second: 59,
    timeZone: RECURRING_MARKET_TIME_ZONE,
  });
}

async function claimNextDueSeries(input: {
  now: Date;
  tx: DbTransaction;
}): Promise<RecurringMarketSeries | null> {
  const [series] = await input.tx
    .select()
    .from(schema.recurringMarketSeries)
    .where(
      and(
        eq(schema.recurringMarketSeries.status, "active"),
        lte(schema.recurringMarketSeries.nextOpenAt, input.now),
      ),
    )
    .orderBy(asc(schema.recurringMarketSeries.nextOpenAt), asc(schema.recurringMarketSeries.id))
    .for("update", { skipLocked: true })
    .limit(1);

  return series ?? null;
}

async function createDueOccurrence(input: {
  db: DbClient;
  now: Date;
  series: RecurringMarketSeries;
  tx: DbTransaction;
}): Promise<string | null> {
  if (!input.series.nextOpenAt) {
    return null;
  }

  const recurrenceDate = localDateKey(input.series.nextOpenAt);

  if (input.series.endsOn && recurrenceDate > input.series.endsOn) {
    await endSeriesFromWorker(input.tx, input.series.id, input.now);
    return null;
  }

  const openedAt = openAtForLocalDate(recurrenceDate);
  const closesAt = closeAtForLocalDate(recurrenceDate);
  const marketId = createId();
  const sourceMarket = await loadMarketForUpdate(input.tx, input.series.sourceMarketId);
  const [market] = await input.tx
    .insert(schema.markets)
    .values({
      closesAt,
      communityId: sourceMarket.communityId,
      creatorUserId: input.series.creatorUserId,
      description: input.series.description,
      id: marketId,
      metadata: input.series.metadata,
      openedAt,
      recurrenceDate,
      recurringSeriesId: input.series.id,
      slug: createSlug(input.series.title),
      status: "open",
      title: input.series.title,
    })
    .onConflictDoNothing({
      target: [schema.markets.recurringSeriesId, schema.markets.recurrenceDate],
    })
    .returning();

  const existing =
    market ?? (await loadExistingOccurrence(input.tx, input.series.id, recurrenceDate));
  const openedMarketId = existing?.id ?? null;

  if (market) {
    await input.tx.insert(schema.contracts).values([
      {
        id: createId(),
        marketId: market.id,
        outcome: "YES",
        title: "YES",
      },
      {
        id: createId(),
        marketId: market.id,
        outcome: "NO",
        title: "NO",
      },
    ]);

    await insertEvent({
      aggregateId: market.id,
      aggregateType: "market",
      db: input.db,
      occurredAt: input.now,
      payload: {
        marketId: market.id,
        recurrenceDate,
        recurringSeriesId: input.series.id,
        status: "open",
      },
      tx: input.tx,
      type: "market.opened",
    });
  }

  const nextDate = nextEligibleDateAfter(
    recurrenceDate,
    input.series.daysOfWeekMask,
    input.series.endsOn,
  );

  await input.tx
    .update(schema.recurringMarketSeries)
    .set({
      nextOpenAt: nextDate ? openAtForLocalDate(nextDate) : null,
      updatedAt: input.now,
    })
    .where(eq(schema.recurringMarketSeries.id, input.series.id));

  return openedMarketId;
}

async function endSeriesFromWorker(tx: DbTransaction, seriesId: string, now: Date) {
  await tx
    .update(schema.recurringMarketSeries)
    .set({
      endedAt: now,
      nextOpenAt: null,
      status: "ended",
      updatedAt: now,
    })
    .where(eq(schema.recurringMarketSeries.id, seriesId));
}

async function loadExistingOccurrence(tx: DbTransaction, seriesId: string, recurrenceDate: string) {
  const [market] = await tx
    .select()
    .from(schema.markets)
    .where(
      and(
        eq(schema.markets.recurringSeriesId, seriesId),
        eq(schema.markets.recurrenceDate, recurrenceDate),
      ),
    )
    .limit(1);

  return market ?? null;
}

async function loadMarketForUpdate(tx: DbTransaction, marketId: string): Promise<RecurringMarket> {
  const [market] = await tx
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId))
    .for("update")
    .limit(1);

  if (!market) {
    throw new Error("Market not found");
  }

  return market;
}

function nextEligibleDateAfter(
  dateKey: string,
  daysOfWeekMask: number,
  endsOn: string | null,
): string | null {
  let parts = parseDateKey(dateKey);

  for (let offset = 1; offset <= 370; offset += 1) {
    parts = addDays(parts, 1);
    const candidate = formatDateKey(parts.year, parts.month, parts.day);

    if (endsOn && candidate > endsOn) {
      return null;
    }

    if (hasDay(daysOfWeekMask, dayOfWeek(parts))) {
      return candidate;
    }
  }

  throw new Error("Failed to find next recurring date");
}

function hasDay(mask: number, day: number): boolean {
  return (mask & (1 << day)) !== 0;
}

function localDayOfWeek(date: Date): number {
  return dayOfWeek(dateParts(date));
}

function dayOfWeek(parts: { day: number; month: number; year: number }): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function addDays(parts: { day: number; month: number; year: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: RECURRING_MARKET_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);

  return {
    day: Number(readPart(parts, "day")),
    month: Number(readPart(parts, "month")),
    year: Number(readPart(parts, "year")),
  };
}

function zonedDateTimeToUtc(input: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  timeZone: string;
  year: number;
}): Date {
  const targetUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
  );
  let candidate = new Date(targetUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateTimeParts(candidate, input.timeZone);
    const candidateWallUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const deltaMs = candidateWallUtc - targetUtc;

    if (deltaMs === 0) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() - deltaMs);
  }

  return candidate;
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const hour = Number(readPart(parts, "hour"));

  return {
    day: Number(readPart(parts, "day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(readPart(parts, "minute")),
    month: Number(readPart(parts, "month")),
    second: Number(readPart(parts, "second")),
    year: Number(readPart(parts, "year")),
  };
}

function normalizeOptionalDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    throw new RangeError("endsOn must use YYYY-MM-DD");
  }

  const parsed = parseDateKey(trimmed);
  const normalized = formatDateKey(parsed.year, parsed.month, parsed.day);

  if (normalized !== trimmed) {
    throw new RangeError("endsOn must be a real date");
  }

  return trimmed;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (!match) {
    throw new RangeError("date must use YYYY-MM-DD");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError("date must be real");
  }

  return { day, month, year };
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function createSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${base || "market"}-${createId().slice(-6).toLowerCase()}`;
}

function mergeRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...left, ...right }).map(([key, value]) => {
      const leftValue = left[key];

      return [key, isRecord(leftValue) && isRecord(value) ? mergeRecords(leftValue, value) : value];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Missing ${type} date part`);
  }

  return part.value;
}
