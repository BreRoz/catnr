"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getJson, newKey, send, toQuery, type Page, type Params } from "./api";

/** Loads a paged, filtered list. Search typing is debounced; the previous page stays visible while the next loads. */
export function useList<T>(resource: string, params: Params, enabled = true) {
  const query = toQuery(params);
  const [state, setState] = useState<{ query: string; tick: number; data?: Page<T>; error?: string }>({ query: "", tick: -1 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await getJson<Page<T>>(resource, Object.fromEntries(new URLSearchParams(query)));
        if (!cancelled) setState({ query, tick, data });
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, query, tick, error: error instanceof Error ? error.message : "Couldn’t load that." }));
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resource, query, tick, enabled]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const stale = state.query !== query || state.tick !== tick;
  return { data: state.data, error: stale ? undefined : state.error, loading: enabled && stale, reload };
}

/** Loads one record (detail sheet) and lets the caller refresh it after a change. */
export function useRecord<T>(resource: string, params: Params, enabled = true) {
  const query = toQuery(params);
  const [state, setState] = useState<{ query: string; tick: number; data?: T; error?: string }>({ query: "", tick: -1 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getJson<T>(resource, Object.fromEntries(new URLSearchParams(query)))
      .then((data) => {
        if (!cancelled) setState({ query, tick, data });
      })
      .catch((error) => {
        if (!cancelled) setState({ query, tick, error: error instanceof Error ? error.message : "Couldn’t load that." });
      });
    return () => {
      cancelled = true;
    };
  }, [resource, query, tick, enabled]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const stale = enabled && state.query !== query;
  return { data: !enabled || stale ? undefined : state.data, error: !enabled || stale ? undefined : state.error, loading: stale, reload };
}

/**
 * Runs one change at a time. The retry key is reused while the same request is being retried (after a
 * failure) and replaced once it succeeds, so a lost response can never create a duplicate.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const last = useRef<{ fingerprint: string; key: string } | null>(null);
  const run = useCallback(
    async <T = { message: string; id?: string }>(
      resource: string,
      body: Record<string, unknown>,
      method: "POST" | "PATCH" = "POST",
    ): Promise<T | null> => {
      const fingerprint = `${resource}|${method}|${JSON.stringify(body)}`;
      if (last.current?.fingerprint !== fingerprint) last.current = { fingerprint, key: newKey() };
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const result = await send<T>(resource, body, last.current.key, method);
        last.current = null;
        setNotice((result as { message?: string }).message || "Saved.");
        return result;
      } catch (e) {
        setError(e instanceof ApiError || e instanceof Error ? e.message : "That didn’t save.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  const clear = useCallback(() => {
    setError("");
    setNotice("");
  }, []);
  return { busy, error, notice, run, clear };
}
