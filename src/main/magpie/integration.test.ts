import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { MagpieManager } from './manager';
import { verifyMagpieBinary } from './integrity';
// Opt-in: build the pinned binary first. All agent configuration stays in a disposable HOME.
it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'discovers and updates a fixture CLI through unchanged upstream HTTP APIs, then stops',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-integration-'));
    const config = path.join(root, '.codex', 'config.toml');
    await fs.mkdir(path.dirname(config));
    await fs.writeFile(config, 'model = "fixture-before"\n');
    await fs.writeFile(
      path.join(root, '.codex/models_cache.json'),
      JSON.stringify({
        models: [{ slug: 'fixture-after', display_name: 'Fixture model', visibility: 'list' }],
      }),
    );
    const manager = new MagpieManager({
      resourcesRoot: path.resolve('resources/magpie'),
      privateHome: path.join(root, 'service'),
      environment: {
        HOME: root,
        USERPROFILE: root,
        APPDATA: path.join(root, 'appdata'),
        LOCALAPPDATA: path.join(root, 'local'),
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: root,
        TMP: root,
      },
      // Vitest runs TS without the emitted worker JS; production uses the bounded worker.
      verify: (dir, signal) =>
        verifyMagpieBinary(dir, signal, async file => {
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          return hash.digest('hex');
        }),
    });
    try {
      expect((await manager.start()).state).toBe('running');
      const field = (await manager.agents()).agents
        .find(a => a.id === 'codex')
        ?.models.find(f => f.key === 'model');
      expect(field?.value).toBe('fixture-before');
      const chosen = field?.options.find(
        option => option.value && option.value !== 'fixture-before',
      )?.value;
      expect(chosen).toBeTruthy();
      const result = await manager.setModel({ agentId: 'codex', field: 'model', value: chosen! });
      expect(
        result.agents.find(a => a.id === 'codex')?.models.find(f => f.key === 'model')?.value,
      ).toBe(chosen);
      expect(await fs.readFile(config, 'utf8')).toContain(`model = "${chosen}"`);
      expect(await manager.models()).toEqual([]);
      expect((await manager.stop()).state).toBe('stopped');
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  45_000,
);
