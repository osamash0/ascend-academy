-- 1. Add last_active_date to public.profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS last_active_date DATE;

-- 2. Add course ratings and what_you_will_learn to public.courses
ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS what_you_will_learn TEXT[] DEFAULT '{}'::TEXT[],
ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2) DEFAULT 4.8,
ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;

-- 3. Create record_daily_activity RPC
CREATE OR REPLACE FUNCTION public.record_daily_activity()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id          UUID := auth.uid();
    _last_active      DATE;
    _current_streak   INTEGER;
    _best_streak      INTEGER;
    _today            DATE := CURRENT_DATE;
BEGIN
    IF _user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock the row for update
    SELECT last_active_date, current_streak, best_streak 
    INTO _last_active, _current_streak, _best_streak
    FROM public.profiles
    WHERE user_id = _user_id
    FOR UPDATE;

    -- If already active today, do nothing
    IF _last_active = _today THEN
        RETURN _current_streak;
    END IF;

    -- If active yesterday, increment streak. Otherwise, reset to 1.
    IF _last_active = _today - INTERVAL '1 day' THEN
        _current_streak := COALESCE(_current_streak, 0) + 1;
    ELSE
        _current_streak := 1;
    END IF;

    -- Update best streak if necessary
    IF _current_streak > COALESCE(_best_streak, 0) THEN
        _best_streak := _current_streak;
    END IF;

    -- Apply the update
    UPDATE public.profiles
    SET 
        last_active_date = _today,
        current_streak = _current_streak,
        best_streak = _best_streak
    WHERE user_id = _user_id;

    RETURN _current_streak;
END;
$$;

REVOKE ALL ON FUNCTION public.record_daily_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_daily_activity() TO authenticated;
