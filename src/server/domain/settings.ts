import type { Queryable } from '../db/types.ts';

export interface Settings {
  linkCreationEnabled: boolean;
  adsEnabled: boolean;
  reportsEnabled: boolean;
}

const KEYS: Record<keyof Settings, string> = {
  linkCreationEnabled: 'link_creation_enabled',
  adsEnabled: 'ads_enabled',
  reportsEnabled: 'reports_enabled',
};

/**
 * Lê as chaves operacionais a cada chamada (sem cache), para que desligar a
 * criação de links ou a publicidade tenha efeito imediato. Na ausência de
 * registro, usa o valor mais conservador.
 */
export async function getSettings(db: Queryable): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: boolean }>('SELECT key, value FROM app.app_settings');
  const map = new Map(rows.map((row) => [row.key, row.value === true]));
  return {
    linkCreationEnabled: map.get(KEYS.linkCreationEnabled) ?? false,
    adsEnabled: map.get(KEYS.adsEnabled) ?? false,
    reportsEnabled: map.get(KEYS.reportsEnabled) ?? true,
  };
}

export async function updateSettings(db: Queryable, patch: Partial<Settings>, updatedBy: string): Promise<Settings> {
  for (const [name, value] of Object.entries(patch) as Array<[keyof Settings, boolean | undefined]>) {
    if (value === undefined) continue;
    await db.query(
      `INSERT INTO app.app_settings (key, value, updated_at, updated_by)
       VALUES ($1, to_jsonb($2::boolean), now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [KEYS[name], value, updatedBy],
    );
  }
  return getSettings(db);
}
