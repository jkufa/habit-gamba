export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Serialized<T> = T extends Date
  ? string
  : T extends bigint
    ? string
    : T extends JsonPrimitive
      ? T
      : T extends readonly unknown[]
        ? number extends T["length"]
          ? Serialized<T[number]>[]
          : { [Key in keyof T]: Serialized<T[Key]> }
        : T extends object
          ? { [Key in keyof T]: Serialized<T[Key]> }
          : T;
