import { expectTypeOf, test } from "vitest";

import type { ExchangeMarketView } from "@habit-gamba/exchange";

import type { Serialized } from "../json";

test("serializes dates and bigints to strings", () => {
  type SerializedShape = Serialized<{
    amount: bigint;
    at: Date;
    id: string;
    nested: {
      count: bigint;
    };
  }>;

  expectTypeOf<SerializedShape>().toEqualTypeOf<{
    amount: string;
    at: string;
    id: string;
    nested: {
      count: string;
    };
  }>();
});

test("keeps fixed market contract tuples tuple-shaped", () => {
  type SerializedMarket = Serialized<ExchangeMarketView>;

  expectTypeOf<SerializedMarket["contracts"]>().toMatchTypeOf<
    readonly [unknown, unknown] | [unknown, unknown]
  >();
  expectTypeOf<SerializedMarket["contracts"][number]["shareSupplyMicro"]>().toEqualTypeOf<string>();
});
