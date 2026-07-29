import { redirect } from 'next/navigation';
import { SECTION_ROUTES } from '@/app/components/console-routes';

/**
 * Legacy /view plate. Read operations now live on each vault detail page
 * (/discover/{vault_id}). Keep this route so old links land somewhere useful.
 */
export default function ViewPage() {
  redirect(SECTION_ROUTES.vaults);
}
