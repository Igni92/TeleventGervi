import { describe, it, expect, vi } from "vitest";
import { cached, invalidate } from "./ttlCache";

/**
 * Cache TTL + coalescence des calculs EN VOL.
 *
 * Le point critique n'est pas le TTL (trivial) mais le fait que N appels
 * concurrents sur une clé froide ne déclenchent qu'UN calcul : sans ça, les
 * utilisateurs qui ouvrent le même écran en même temps se ralentissent
 * mutuellement en recalculant tous la même chose. Module PUR → test hors-ligne.
 */
describe("ttlCache — mémorisation et coalescence", () => {
  it("sert la valeur en cache tant que le TTL court (1 seul calcul)", async () => {
    const compute = vi.fn(async () => 42);
    const k = `t:hit:${Math.random()}`;
    expect(await cached(k, 60_000, compute)).toBe(42);
    expect(await cached(k, 60_000, compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("N appels CONCURRENTS sur une clé froide ne déclenchent qu'un calcul", async () => {
    let resolveIt: (v: number) => void = () => {};
    const gate = new Promise<number>((r) => { resolveIt = r; });
    const compute = vi.fn(() => gate);
    const k = `t:coalesce:${Math.random()}`;

    // Les 5 partent AVANT que le premier n'ait fini : c'est le cas réel (plusieurs
    // onglets/personnes ouvrant l'écran au même instant).
    const all = Promise.all([1, 2, 3, 4, 5].map(() => cached(k, 60_000, compute)));
    resolveIt(7);
    expect(await all).toEqual([7, 7, 7, 7, 7]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("un calcul en échec n'est pas mis en cache — la tentative suivante recalcule", async () => {
    const k = `t:err:${Math.random()}`;
    const boom = vi.fn(async () => { throw new Error("SAP indisponible"); });
    await expect(cached(k, 60_000, boom)).rejects.toThrow("SAP indisponible");

    const ok = vi.fn(async () => 1);
    expect(await cached(k, 60_000, ok)).toBe(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("recalcule une fois le TTL écoulé", async () => {
    const compute = vi.fn(async () => Math.random());
    const k = `t:ttl:${Math.random()}`;
    const a = await cached(k, 0, compute);   // TTL 0 → déjà expiré au prochain appel
    const b = await cached(k, 0, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });

  it("invalidate purge par PRÉFIXE (et la clé exacte)", async () => {
    const c1 = vi.fn(async () => "a");
    const c2 = vi.fn(async () => "b");
    await cached("dom:un", 60_000, c1);
    await cached("dom:deux", 60_000, c2);

    invalidate("dom:");

    await cached("dom:un", 60_000, c1);
    await cached("dom:deux", 60_000, c2);
    expect(c1).toHaveBeenCalledTimes(2);
    expect(c2).toHaveBeenCalledTimes(2);
  });
});
