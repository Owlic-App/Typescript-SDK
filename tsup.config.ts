import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Inline ONLY the private @owlic/api-contract types into the emitted .d.ts
  // (the contract package is unpublished and must not leak as a dependency).
  // zod stays an external type import — rollup-plugin-dts cannot flatten
  // `z.infer` (it emits `undefined<...>`), so zod is a real (type-level)
  // dependency of the published package instead.
  dts: { resolve: [/^@owlic\/api-contract/] },
  target: 'es2022',
  sourcemap: true,
  clean: true,
  treeshake: true,
});
