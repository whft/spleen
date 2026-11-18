
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export const isOverviewFeatureAvailable = () => {
  const raw = process.env.SPLEEN_OVERVIEW_ENABLED;
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase());
};
