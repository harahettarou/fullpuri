// Run the existing v15/v17 regressions against the v18 single-file Worker.
export async function resolve(specifier,context,nextResolve){return nextResolve(specifier.endsWith('/server/worker_v15.mjs')?specifier.replace('/server/worker_v15.mjs','/server/worker_v18.mjs'):specifier,context)}
