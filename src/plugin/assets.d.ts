// esbuild inlines these as data: URLs via the `.woff2=dataurl` loader.
declare module '*.woff2' {
  const url: string;
  export default url;
}
