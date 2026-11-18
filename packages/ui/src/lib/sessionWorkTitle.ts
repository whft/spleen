import { z } from 'zod';
import type { Metadata } from '@/lib/opencode/model';

const spleenSchema = z.object({ spleen: z.record(z.string(), z.json()) });

const workTitleSchema = z.object({ title: z.string().trim().min(1) });
const userWorkTitleSchema = workTitleSchema.extend({ by: z.literal('user') });

export function carriedWorkTitleOwner(metadata: Metadata | undefined): 'user' | 'agent' {
  const value = userWorkTitleSchema.safeParse(spleenSchema.safeParse(metadata).data?.spleen.workTitle);
  return value.success ? 'user' : 'agent';
}

export function withUserWorkTitle(metadata: Metadata, title: string): Metadata {
  const namespace = spleenSchema.safeParse(metadata).data?.spleen ?? {};
  return { ...metadata, spleen: { ...namespace, workTitle: { title, by: 'user' } } };
}
