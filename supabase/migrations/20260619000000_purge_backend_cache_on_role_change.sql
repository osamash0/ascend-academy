-- Purge backend cache entry on user_roles change
--
-- Since user tokens are cached in backend_cache for up to 45 seconds (to avoid 
-- redundant Supabase Auth queries), changes/deletions in public.user_roles could 
-- leave a user operating under a stale role. This trigger immediately purges 
-- matching cached tokens when their role shifts.
--
-- SECURITY DEFINER allows the trigger to delete rows from backend_cache, which 
-- is restricted by RLS to service_role only.

CREATE OR REPLACE FUNCTION public.purge_backend_cache_on_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    DELETE FROM public.backend_cache
    WHERE (data->>'id') = OLD.user_id::text;
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    DELETE FROM public.backend_cache
    WHERE (data->>'id') = NEW.user_id::text;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_purge_backend_cache_on_role_change ON public.user_roles;
CREATE TRIGGER trigger_purge_backend_cache_on_role_change
AFTER INSERT OR UPDATE OR DELETE
ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.purge_backend_cache_on_role_change();
