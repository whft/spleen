export const SPLEEN_SDK_CHANNEL = 'spleen.sdk';
export const SPLEEN_SDK_API_VERSION = 1;
export const SPLEEN_SDK_MANIFEST_API_VERSIONS = [1] as const;
export type SpleenManifestApiVersion = (typeof SPLEEN_SDK_MANIFEST_API_VERSIONS)[number];
