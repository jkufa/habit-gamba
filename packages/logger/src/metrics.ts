export type MetricLabels = Record<string, string | undefined>;

export type CounterMetric = {
  add: (value: number, labels?: MetricLabels) => void;
};

export type GaugeMetric = {
  set: (value: number, labels?: MetricLabels) => void;
};

export type HistogramMetric = {
  observe: (value: number, labels?: MetricLabels) => void;
};

export type MetricsRegistry = {
  counter: (name: string, help: string) => CounterMetric;
  gauge: (name: string, help: string) => GaugeMetric;
  histogram: (name: string, help: string, buckets?: number[]) => HistogramMetric;
  render: () => string;
};

type MetricDefinition =
  | {
      help: string;
      name: string;
      samples: Map<string, number>;
      type: "counter" | "gauge";
    }
  | {
      buckets: number[];
      help: string;
      name: string;
      observations: Map<string, { count: number; sum: number; buckets: number[] }>;
      type: "histogram";
    };

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

export function createMetricsRegistry(): MetricsRegistry {
  const definitions = new Map<string, MetricDefinition>();

  return {
    counter: (name, help) => {
      const definition = getCounterOrGauge(definitions, name, help, "counter");

      return {
        add: (value, labels) => {
          const key = labelsKey(labels);
          definition.samples.set(key, (definition.samples.get(key) ?? 0) + value);
        },
      };
    },
    gauge: (name, help) => {
      const definition = getCounterOrGauge(definitions, name, help, "gauge");

      return {
        set: (value, labels) => {
          definition.samples.set(labelsKey(labels), value);
        },
      };
    },
    histogram: (name, help, buckets = DEFAULT_BUCKETS) => {
      const existing = definitions.get(name);
      const definition =
        existing?.type === "histogram"
          ? existing
          : {
              buckets,
              help,
              name,
              observations: new Map(),
              type: "histogram" as const,
            };

      definitions.set(name, definition);

      return {
        observe: (value, labels) => {
          const key = labelsKey(labels);
          const existingObservation = definition.observations.get(key) ?? {
            buckets: definition.buckets.map(() => 0),
            count: 0,
            sum: 0,
          };

          for (const [index, bucket] of definition.buckets.entries()) {
            if (value <= bucket) {
              existingObservation.buckets[index] = (existingObservation.buckets[index] ?? 0) + 1;
            }
          }

          existingObservation.count += 1;
          existingObservation.sum += value;
          definition.observations.set(key, existingObservation);
        },
      };
    },
    render: () => renderMetrics(definitions),
  };
}

function getCounterOrGauge(
  definitions: Map<string, MetricDefinition>,
  name: string,
  help: string,
  type: "counter" | "gauge",
) {
  const existing = definitions.get(name);

  if (existing?.type === type) {
    return existing;
  }

  const definition = {
    help,
    name,
    samples: new Map<string, number>(),
    type,
  };

  definitions.set(name, definition);
  return definition;
}

function renderMetrics(definitions: Map<string, MetricDefinition>): string {
  const lines: string[] = [];

  for (const definition of definitions.values()) {
    lines.push(`# HELP ${definition.name} ${definition.help}`);
    lines.push(`# TYPE ${definition.name} ${definition.type}`);

    if (definition.type === "histogram") {
      for (const [key, observation] of definition.observations) {
        const labels = labelsFromKey(key);

        for (const [index, bucket] of definition.buckets.entries()) {
          lines.push(
            `${definition.name}_bucket${formatLabels({ ...labels, le: String(bucket) })} ${
              observation.buckets[index] ?? 0
            }`,
          );
        }

        lines.push(
          `${definition.name}_bucket${formatLabels({ ...labels, le: "+Inf" })} ${
            observation.count
          }`,
        );
        lines.push(`${definition.name}_sum${formatLabels(labels)} ${observation.sum}`);
        lines.push(`${definition.name}_count${formatLabels(labels)} ${observation.count}`);
      }
    } else {
      for (const [key, value] of definition.samples) {
        lines.push(`${definition.name}${formatLabels(labelsFromKey(key))} ${value}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function labelsKey(labels: MetricLabels = {}): string {
  return JSON.stringify(
    Object.entries(labels)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function labelsFromKey(key: string): Record<string, string> {
  return Object.fromEntries(JSON.parse(key) as [string, string][]);
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);

  if (entries.length === 0) {
    return "";
  }

  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}
