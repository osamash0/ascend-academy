export interface LectureOverview {
  total_students: number;
  completion_rate: number;
  average_score: number;
  average_time_minutes: number;
  engagement_level: string;
}

export interface SlideAnalytics {
  slide_number: number;
  title: string;
  view_count: number;
  average_time_seconds: number;
  drop_off_rate: number;
}

export interface QuizAnalytics {
  question_id: string;
  question_text: string;
  success_rate: number;
  difficulty: string;
  attempts: number;
}

export interface StudentPerformance {
  student_id: string;
  student_name: string;
  progress_percentage: number;
  quiz_score: number;
  status: "Excelling" | "On Track" | "At Risk";
}
