import type { Serialized } from "./json";

export type ApiOk<T> = {
  data: Serialized<T>;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    details?: unknown;
    message: string;
  };
};

export type HealthResponse = {
  ok: true;
  service: string;
};
