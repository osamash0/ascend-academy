-- Create app_role enum for user roles
CREATE TYPE public.app_role AS ENUM ('student', 'professor');

-- Create user_roles table (following security best practices - roles in separate table)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'student',
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    total_xp INTEGER DEFAULT 0,
    current_level INTEGER DEFAULT 1,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create lectures table
CREATE TABLE public.lectures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    pdf_url TEXT,
    professor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    total_slides INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;

-- Create slides table
CREATE TABLE public.slides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id UUID REFERENCES public.lectures(id) ON DELETE CASCADE NOT NULL,
    slide_number INTEGER NOT NULL,
    title TEXT,
    content_text TEXT,
    summary TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.slides ENABLE ROW LEVEL SECURITY;

-- Create quiz_questions table
CREATE TABLE public.quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slide_id UUID REFERENCES public.slides(id) ON DELETE CASCADE NOT NULL,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',
    correct_answer INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

-- Create learning_events table for analytics
CREATE TABLE public.learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    event_type TEXT NOT NULL,
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

-- Create student_progress table
CREATE TABLE public.student_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    lecture_id UUID REFERENCES public.lectures(id) ON DELETE CASCADE NOT NULL,
    xp_earned INTEGER DEFAULT 0,
    completed_slides INTEGER[] DEFAULT '{}',
    quiz_score INTEGER DEFAULT 0,
    total_questions_answered INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    last_slide_viewed INTEGER DEFAULT 1,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, lecture_id)
);

ALTER TABLE public.student_progress ENABLE ROW LEVEL SECURITY;

-- Create achievements table
CREATE TABLE public.achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    badge_name TEXT NOT NULL,
    badge_description TEXT,
    badge_icon TEXT,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- user_roles policies
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own role on signup"
ON public.user_roles FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- profiles policies
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- lectures policies
CREATE POLICY "Anyone can view lectures"
ON public.lectures FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Professors can create lectures"
ON public.lectures FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'professor'));

CREATE POLICY "Professors can update their own lectures"
ON public.lectures FOR UPDATE
TO authenticated
USING (professor_id = auth.uid() AND public.has_role(auth.uid(), 'professor'));

CREATE POLICY "Professors can delete their own lectures"
ON public.lectures FOR DELETE
TO authenticated
USING (professor_id = auth.uid() AND public.has_role(auth.uid(), 'professor'));

-- slides policies
CREATE POLICY "Anyone can view slides"
ON public.slides FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Professors can manage slides"
ON public.slides FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.lectures 
        WHERE id = slides.lecture_id 
        AND professor_id = auth.uid()
    )
);

-- quiz_questions policies
CREATE POLICY "Anyone can view quiz questions"
ON public.quiz_questions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Professors can manage quiz questions"
ON public.quiz_questions FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.slides s
        JOIN public.lectures l ON l.id = s.lecture_id
        WHERE s.id = quiz_questions.slide_id 
        AND l.professor_id = auth.uid()
    )
);

-- learning_events policies
CREATE POLICY "Users can view their own events"
ON public.learning_events FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own events"
ON public.learning_events FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Professors can view all events"
ON public.learning_events FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'professor'));

-- student_progress policies
CREATE POLICY "Users can view their own progress"
ON public.student_progress FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own progress"
ON public.student_progress FOR ALL
USING (auth.uid() = user_id);

CREATE POLICY "Professors can view all progress"
ON public.student_progress FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'professor'));

-- achievements policies
CREATE POLICY "Users can view their own achievements"
ON public.achievements FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can insert achievements"
ON public.achievements FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Professors can view all achievements"
ON public.achievements FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'professor'));

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (user_id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$;

-- Trigger to create profile on user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update XP and level
CREATE OR REPLACE FUNCTION public.add_xp_to_user(p_user_id UUID, p_xp INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_total_xp INTEGER;
    new_level INTEGER;
BEGIN
    UPDATE public.profiles 
    SET total_xp = total_xp + p_xp
    WHERE user_id = p_user_id
    RETURNING total_xp INTO new_total_xp;
    
    -- Calculate new level (level up every 100 XP)
    new_level := FLOOR(new_total_xp / 100) + 1;
    
    UPDATE public.profiles
    SET current_level = new_level
    WHERE user_id = p_user_id;
END;
$$;

-- Function to update streak
CREATE OR REPLACE FUNCTION public.update_user_streak(p_user_id UUID, p_correct BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_streak_val INTEGER;
    best_streak_val INTEGER;
BEGIN
    IF p_correct THEN
        UPDATE public.profiles 
        SET current_streak = current_streak + 1
        WHERE user_id = p_user_id
        RETURNING current_streak, best_streak INTO current_streak_val, best_streak_val;
        
        IF current_streak_val > best_streak_val THEN
            UPDATE public.profiles 
            SET best_streak = current_streak_val
            WHERE user_id = p_user_id;
        END IF;
    ELSE
        UPDATE public.profiles 
        SET current_streak = 0
        WHERE user_id = p_user_id;
        current_streak_val := 0;
    END IF;
    
    RETURN current_streak_val;
END;
$$;