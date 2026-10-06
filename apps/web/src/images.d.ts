// Типы статического импорта картинок (`import logo from '@/assets/logo.png'`). Обычно их даёт next-env.d.ts, но он
// создаётся при `next dev/build` и лежит в .gitignore, поэтому в CI на шагах lint и typecheck (до сборки) его нет.
/// <reference types="next/image-types/global" />
