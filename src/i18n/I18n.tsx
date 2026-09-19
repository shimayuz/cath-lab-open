import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  LOCALE_STORAGE_KEY,
  readLocale,
  translate,
  translator,
} from "./messages";
import type { Locale, Message } from "./messages";

type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: ReturnType<typeof translator>;
  format: (text: Message | string) => string;
};
const Context = createContext<I18n | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      return readLocale(window.localStorage);
    } catch {
      return "ja";
    }
  });
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: translator(locale),
      format: (text: Message | string) => translate(locale, text),
    }),
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `Cath Lab — ${value.t("心臓への、一歩。")}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        value.t(
          "学生や若手研修医が、心臓への経路とカテーテルの動きに親しむための体験教材です。",
        ),
      );
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* The session can still switch languages without storage. */
    }
  }, [locale, value]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  const context = useContext(Context);
  if (!context) throw new Error("I18nProvider is required");
  return context;
}
