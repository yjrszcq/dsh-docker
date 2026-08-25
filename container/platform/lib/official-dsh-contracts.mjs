import { compareDshVersions } from './supported-target.mjs'

export const OFFICIAL_DSH_PACKAGE = '@deepseek-ai/dsh'
export const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const OFFICIAL_DSH_METADATA_LIMIT = 20 * 1024 * 1024
export const OFFICIAL_DSH_TARBALL_LIMIT = 512 * 1024 * 1024

export function officialDshMetadataUrl() {
  return new URL(encodeURIComponent(OFFICIAL_DSH_PACKAGE), OFFICIAL_NPM_REGISTRY)
}

export function officialDshTarballUrl(version) {
  compareDshVersions(version, version)
  return new URL(`${OFFICIAL_DSH_PACKAGE}/-/dsh-${version}.tgz`, OFFICIAL_NPM_REGISTRY)
}
