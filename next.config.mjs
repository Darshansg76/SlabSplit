import { preserveLegacyReceipts } from './scripts/receipt-storage.mjs';

const importedReceipts=await preserveLegacyReceipts();
if(importedReceipts) console.log(`Protected ${importedReceipts} existing receipt file(s); their URLs are unchanged.`);

const config={
  distDir:process.env.SLABSPLIT_DIST_DIR||'.next',
  async rewrites() {
    return {beforeFiles:[{source:'/uploads/:path*',destination:'/api/receipts/file/:path*'}]};
  }
};
export default config;
