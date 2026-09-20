declare module "*.asset.json" {
  const value: { url: string; asset_id: string; content_type: string };
  export default value;
}
