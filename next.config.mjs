/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingIncludes: { '/api/**': ['./lib/pipeline/prompts/*.md'] },
};
