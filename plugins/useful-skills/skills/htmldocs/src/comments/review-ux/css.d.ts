// esbuild's text loader turns a `.css` import into the file's contents as a
// default-exported string. This ambient declaration lets tsc typecheck those
// imports (e.g. mount.ts's `import STYLES from './styles.css'`).
declare module '*.css' {
  const content: string;
  export default content;
}
