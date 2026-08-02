import { createHash } from "node:crypto";

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    if (isHighSurrogate) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>(), "$");
}

export function digestJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalize(value: unknown, ancestors: Set<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) {
      throw new TypeError(`Expected valid Unicode scalar values at ${path}.`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Expected a finite number at ${path}.`);
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`Cyclic JSON value at ${path}.`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1) {
      throw new TypeError(`Expected only dense array properties at ${path}.`);
    }
    for (const key of ownKeys) {
      if (key === "length") continue;
      if (
        typeof key !== "string" ||
        !/^(0|[1-9]\d*)$/u.test(key) ||
        Number(key) >= value.length
      ) {
        throw new TypeError(`Unexpected array property at ${path}.`);
      }
    }

    ancestors.add(value);
    try {
      const values: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(`Expected an array data property at ${path}[${index}].`);
        }
        values.push(canonicalize(descriptor.value, ancestors, `${path}[${index}]`));
      }
      return `[${values.join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Expected a plain object JSON value at ${path}.`);
    }
    if (ancestors.has(value)) throw new TypeError(`Cyclic JSON value at ${path}.`);

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const ownKeys = Reflect.ownKeys(record);
    if (ownKeys.length !== keys.length) {
      throw new TypeError(`Expected only enumerable string keys in JSON value at ${path}.`);
    }

    ancestors.add(value);
    try {
      const entries: string[] = [];
      for (const key of keys) {
        if (!isWellFormedUnicode(key)) {
          throw new TypeError(`Expected valid Unicode scalar values in object keys at ${path}.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(`Expected a plain data property at ${path}.${key}.`);
        }
        entries.push(
          `${JSON.stringify(key)}:${canonicalize(descriptor.value, ancestors, `${path}.${key}`)}`
        );
      }
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }

  throw new TypeError(`Expected a JSON value at ${path}, received ${typeof value}.`);
}
