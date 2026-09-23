// Границы модулей (ARCHITECTURE.md, 4.2). Нарушение — ошибка в CI.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Циклические зависимости запрещены.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'domain/ — чистый TypeScript: без NestJS, Prisma и других слоёв.',
      from: { path: '^apps/api/src/modules/[^/]+/domain/' },
      to: {
        pathNot: ['^apps/api/src/modules/[^/]+/domain/', '^packages/contracts/'],
        dependencyTypesNot: ['type-only'],
        path: ['^apps/api/src/', 'node_modules/@nestjs/', 'node_modules/@prisma/', 'node_modules/@sde/db'],
      },
    },
    {
      name: 'module-public-interface-only',
      severity: 'error',
      comment: 'Модуль импортирует из другого модуля только его index.ts.',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/([^/]+)/.+',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'web-only-contracts-and-ui',
      severity: 'error',
      comment: 'apps/web импортирует из монорепозитория только packages/contracts и packages/ui.',
      from: { path: '^apps/web/' },
      to: { path: '^(apps/(api|worker)|packages/db)/' },
    },
    {
      name: 'contracts-are-leaf',
      severity: 'error',
      comment: 'packages/contracts не зависит от приложений и БД.',
      from: { path: '^packages/contracts/' },
      to: { path: '^(apps/|packages/(db|ui)/)' },
    },
    {
      name: 'no-apps-cross-import',
      severity: 'error',
      from: { path: '^apps/(api|worker)/' },
      to: { path: '^apps/(web)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|\\.next|generated|coverage|node_modules)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
