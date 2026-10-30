import type { AccessiOptions } from '../AccessiModule';

/** Valore ammesso per un label Prometheus. */
export type AccessiMetricLabelValue = string | number | boolean | undefined;
export type AccessiMetricLabels = Record<string, AccessiMetricLabelValue>;

/**
 * Destinazione delle metriche Accessi.
 *
 * L'implementazione predefinita e il registry in memoria renderizzato in
 * formato Prometheus. Un host puo passare un sink custom (OpenTelemetry,
 * StatsD, ...) tramite `metrics.sink`.
 */
export interface AccessiMetricsSink {
  increment(name: string, value?: number, labels?: AccessiMetricLabels): void;
  gauge?(name: string, value: number, labels?: AccessiMetricLabels): void;
  observe?(name: string, valueMs: number, labels?: AccessiMetricLabels): void;
}

/** Opzioni di osservabilita di Accessi. */
export interface AccessiMetricsOptions {
  /** `false` disabilita le metriche di dominio. Default: abilitate. */
  enabled?: boolean;
  /** Sink custom. Default: registry in memoria. */
  sink?: AccessiMetricsSink;
  /** Prefisso dei nomi. Default `accessi`. */
  prefix?: string;
}

export interface AccessiMetricsRegistry extends AccessiMetricsSink {
  observe(name: string, valueMs: number, labels?: AccessiMetricLabels): void;
  gauge(name: string, value: number, labels?: AccessiMetricLabels): void;
  renderPrometheus(): string;
  snapshot(): AccessiMetricsSnapshot;
  reset(): void;
}

export interface AccessiMetricsSnapshot {
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>;
  gauges: Array<{ name: string; labels: Record<string, string>; value: number }>;
  histograms: Array<{
    name: string;
    labels: Record<string, string>;
    count: number;
    sum: number;
    buckets: Array<{ le: number; count: number }>;
  }>;
}

const HISTOGRAM_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function normalizeValue(value: AccessiMetricLabelValue): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function normalizeLabels(labels: AccessiMetricLabels | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(labels ?? {})) {
    const text = normalizeValue(value);
    if (text !== undefined && LABEL_NAME.test(name)) normalized[name] = text;
  }
  return normalized;
}

function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${labels[name]}`)
    .join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderLabels(labels: Record<string, string>, extra?: [string, string]): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (extra) entries.push(extra);
  if (entries.length === 0) return '';
  return `{${entries.map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(',')}}`;
}

function metricName(name: string): string {
  return METRIC_NAME.test(name) ? name : name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

/**
 * Registry in memoria con rendering Prometheus.
 *
 * Non usa dipendenze: la stessa struttura e usata dal servizio standalone e
 * dai test. `reset()` serve per isolare i test.
 */
export function createAccessiMetricsRegistry(): AccessiMetricsRegistry {
  const counters = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
  const gauges = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
  const histograms = new Map<string, {
    name: string;
    labels: Record<string, string>;
    counts: number[];
    sum: number;
    count: number;
  }>();

  const entryKey = (name: string, labels: Record<string, string>) => `${metricName(name)}|${labelKey(labels)}`;

  return {
    increment(name, value = 1, labels) {
      const normalizedName = metricName(name);
      const normalizedLabels = normalizeLabels(labels);
      const key = entryKey(normalizedName, normalizedLabels);
      const current = counters.get(key);
      if (current) current.value += value;
      else counters.set(key, { name: normalizedName, labels: normalizedLabels, value });
    },
    gauge(name, value, labels) {
      const normalizedName = metricName(name);
      const normalizedLabels = normalizeLabels(labels);
      gauges.set(entryKey(normalizedName, normalizedLabels), {
        name: normalizedName,
        labels: normalizedLabels,
        value,
      });
    },
    observe(name, valueMs, labels) {
      if (!Number.isFinite(valueMs) || valueMs < 0) return;
      const normalizedName = metricName(name);
      const normalizedLabels = normalizeLabels(labels);
      const key = entryKey(normalizedName, normalizedLabels);
      let entry = histograms.get(key);
      if (!entry) {
        entry = {
          name: normalizedName,
          labels: normalizedLabels,
          counts: HISTOGRAM_BUCKETS_MS.map(() => 0),
          sum: 0,
          count: 0,
        };
        histograms.set(key, entry);
      }
      entry.sum += valueMs;
      entry.count += 1;
      const histogram = entry;
      HISTOGRAM_BUCKETS_MS.forEach((bucket, index) => {
        if (valueMs <= bucket) histogram.counts[index] = (histogram.counts[index] ?? 0) + 1;
      });
    },
    renderPrometheus() {
      const lines: string[] = [];
      const grouped = <T extends { name: string }>(entries: T[]): Array<[string, T[]]> => {
        const byName = new Map<string, T[]>();
        for (const entry of entries) {
          const bucket = byName.get(entry.name);
          if (bucket) bucket.push(entry);
          else byName.set(entry.name, [entry]);
        }
        return [...byName.entries()].sort(([left], [right]) => left.localeCompare(right));
      };
      const sorted = <T extends { name: string; labels: Record<string, string> }>(entries: T[]) =>
        [...entries].sort((left, right) => labelKey(left.labels).localeCompare(labelKey(right.labels)));

      for (const [name, entries] of grouped([...counters.values()])) {
        lines.push(`# HELP ${name} Accessi metric.`);
        lines.push(`# TYPE ${name} counter`);
        for (const entry of sorted(entries)) lines.push(`${name}${renderLabels(entry.labels)} ${entry.value}`);
      }

      for (const [name, entries] of grouped([...gauges.values()])) {
        lines.push(`# HELP ${name} Accessi metric.`);
        lines.push(`# TYPE ${name} gauge`);
        for (const entry of sorted(entries)) lines.push(`${name}${renderLabels(entry.labels)} ${entry.value}`);
      }

      for (const [name, entries] of grouped([...histograms.values()])) {
        lines.push(`# HELP ${name} Accessi metric.`);
        lines.push(`# TYPE ${name} histogram`);
        for (const entry of sorted(entries)) {
          HISTOGRAM_BUCKETS_MS.forEach((bucket, index) => {
            lines.push(`${name}_bucket${renderLabels(entry.labels, ['le', String(bucket)])} ${entry.counts[index]}`);
          });
          lines.push(`${name}_bucket${renderLabels(entry.labels, ['le', '+Inf'])} ${entry.count}`);
          lines.push(`${name}_sum${renderLabels(entry.labels)} ${entry.sum}`);
          lines.push(`${name}_count${renderLabels(entry.labels)} ${entry.count}`);
        }
      }

      return lines.length > 0 ? `${lines.join('\n')}\n` : '';
    },
    snapshot() {
      return {
        counters: [...counters.values()].map((entry) => ({ ...entry, labels: { ...entry.labels } })),
        gauges: [...gauges.values()].map((entry) => ({ ...entry, labels: { ...entry.labels } })),
        histograms: [...histograms.values()].map((entry) => ({
          name: entry.name,
          labels: { ...entry.labels },
          count: entry.count,
          sum: entry.sum,
          buckets: HISTOGRAM_BUCKETS_MS.map((le, index) => ({ le, count: entry.counts[index] ?? 0 })),
        })),
      };
    },
    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
    },
  };
}

const defaultRegistry = createAccessiMetricsRegistry();

/** Registry globale usato da Accessi e dal servizio standalone. */
export function getAccessiMetricsRegistry(): AccessiMetricsRegistry {
  return defaultRegistry;
}

/** Sink configurato per l'istanza, oppure registry globale. */
export function getAccessiMetricsSink(options: AccessiOptions | undefined): AccessiMetricsSink | undefined {
  if (options?.metrics?.enabled === false) return undefined;
  return options?.metrics?.sink ?? defaultRegistry;
}

/** Registra una metrica sul registry globale (usato da store e moduli senza options). */
export function recordAccessiMetric(
  name: string,
  value = 1,
  labels?: AccessiMetricLabels,
): void {
  defaultRegistry.increment(name, value, labels);
}

/** Registra una durata in millisecondi sul registry globale. */
export function recordAccessiDuration(
  name: string,
  valueMs: number,
  labels?: AccessiMetricLabels,
): void {
  defaultRegistry.observe(name, valueMs, labels);
}

/** Render Prometheus del registry globale. */
export function renderAccessiMetrics(): string {
  return defaultRegistry.renderPrometheus();
}

/** Azzera il registry globale (test e reset espliciti). */
export function resetAccessiMetrics(): void {
  defaultRegistry.reset();
}

/** Prefisso configurato, con normalizzazione per evitare nomi non validi. */
export function accessiMetricName(options: AccessiOptions | undefined, name: string): string {
  const prefix = options?.metrics?.prefix ?? 'accessi';
  if (!prefix.trim()) return name;
  return `${prefix.trim().replace(/[^a-zA-Z0-9_:]/g, '_')}_${name}`;
}

/** Incrementa un contatore di dominio sull'istanza (o sul registry globale). */
export function countAccessiMetric(
  options: AccessiOptions | undefined,
  name: string,
  labels?: AccessiMetricLabels,
  value = 1,
): void {
  getAccessiMetricsSink(options)?.increment(accessiMetricName(options, name), value, labels);
}

/** Registra una durata di dominio in millisecondi. */
export function observeAccessiMetric(
  options: AccessiOptions | undefined,
  name: string,
  valueMs: number,
  labels?: AccessiMetricLabels,
): void {
  const sink = getAccessiMetricsSink(options);
  sink?.observe?.(accessiMetricName(options, name), valueMs, labels);
}
