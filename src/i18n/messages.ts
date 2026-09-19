import { ja } from "./ja";
import type { MessageKey } from "./ja";
import { en } from "./en";

export type Locale = "ja" | "en";
export type MessageValue = string | number | Message;
export interface Message {
  readonly key: MessageKey;
  readonly values: readonly MessageValue[];
}
type Arguments<S extends string> = S extends `${string}{${number}}${infer Rest}`
  ? [MessageValue, ...Arguments<Rest>]
  : [];

/** Keep simulation and asynchronous errors independent of the display language. */
export function message<K extends MessageKey>(
  key: K,
  ...values: Arguments<K>
): Message {
  return { key, values };
}
export function translate(locale: Locale, text: Message | string): string {
  if (typeof text === "string") return text;
  const template = (locale === "en" ? en : ja)[text.key];
  return template.replace(/\{(\d+)\}/g, (_, index: string) => {
    const value = text.values[Number(index)];
    return typeof value === "object"
      ? translate(locale, value)
      : String(value ?? "");
  });
}
export function translator(locale: Locale) {
  return <K extends MessageKey>(key: K, ...values: Arguments<K>) =>
    translate(locale, message(key, ...values));
}
export const LOCALE_STORAGE_KEY = "cath-lab.locale";
export function readLocale(storage?: Pick<Storage, "getItem">): Locale {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) === "en" ? "en" : "ja";
  } catch {
    return "ja";
  }
}
