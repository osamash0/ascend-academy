/**
 * PixiLab — experimental playground for the PixiJS POCs on this branch.
 *
 * Mounts all three scenes (skill tree, practice match game, onboarding journey
 * map) with self-contained sample data so they can be viewed without a logged-in
 * student. Route: /pixi-lab. Not linked anywhere — dev-only, like PipelineTest.
 */
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { SkillTreePixiView } from '@/features/skilltree/pixi/SkillTreePixiView';
import { PracticeMatchGame } from '@/features/practice_sheets/pixi/PracticeMatchGame';
import { OnboardingJourneyMap } from '@/features/onboarding/pixi/OnboardingJourneyMap';
import type { SkillNode } from '@/features/skilltree/skillTree';
import type { PracticeSheetQuestion } from '@/services/practiceSheetsService';

const SAMPLE_TREE: SkillNode = {
  id: 'root',
  label: 'Mein Wissen',
  kind: 'root',
  state: 'owned',
  children: [
    {
      id: 'c1',
      label: 'Anatomie',
      kind: 'course',
      state: 'owned',
      children: [
        { id: 'l1', label: 'Skelett', kind: 'lecture', state: 'owned', lectureId: 'l1' },
        { id: 'l2', label: 'Muskeln', kind: 'lecture', state: 'in_progress', progress: 0.6, lectureId: 'l2' },
        { id: 'l3', label: 'Nerven', kind: 'lecture', state: 'available', lectureId: 'l3' },
        { id: 'l4', label: 'Gefäße', kind: 'lecture', state: 'locked', lectureId: 'l4' },
      ],
    },
    {
      id: 'c2',
      label: 'Physiologie',
      kind: 'course',
      state: 'in_progress',
      children: [
        { id: 'l5', label: 'Herz', kind: 'lecture', state: 'in_progress', progress: 0.3, lectureId: 'l5' },
        { id: 'l6', label: 'Niere', kind: 'lecture', state: 'locked', lectureId: 'l6' },
      ],
    },
    {
      id: 'c3',
      label: 'Biochemie',
      kind: 'course',
      state: 'available',
      children: [
        { id: 'l7', label: 'Enzyme', kind: 'lecture', state: 'available', lectureId: 'l7' },
        { id: 'l8', label: 'Stoffwechsel', kind: 'lecture', state: 'locked', lectureId: 'l8' },
      ],
    },
  ],
};

const SAMPLE_QUESTIONS: PracticeSheetQuestion[] = [
  ['q1', 'Powerhouse of the cell?', 'Mitochondria'],
  ['q2', 'Largest organ in the body?', 'Skin'],
  ['q3', 'Carries oxygen in blood?', 'Hemoglobin'],
  ['q4', 'Bones in the adult human body?', '206'],
  ['q5', 'Master gland of the body?', 'Pituitary'],
  ['q6', 'Filters blood to make urine?', 'Kidney'],
].map(([id, prompt, answer], i) => ({
  id,
  sheet_id: 'demo',
  order_index: i,
  type: 'mc',
  prompt,
  choices: null,
  correct_answer: answer,
  explanation: null,
  source_quiz_question_id: null,
  created_at: null,
  updated_at: null,
})) as PracticeSheetQuestion[];

const STEP_LABELS = ['Profil', 'Sprache', 'Universität', 'Kurse', 'Inhalte'];

export default function PixiLab() {
  const [step, setStep] = useState(1);

  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="mb-1 text-2xl font-bold text-foreground">Pixi Lab</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Experimental PixiJS scenes · branch <code>feature/building-scene</code>
      </p>

      <Tabs defaultValue="skilltree">
        <TabsList>
          <TabsTrigger value="skilltree">Skill Tree</TabsTrigger>
          <TabsTrigger value="match">Practice Match</TabsTrigger>
          <TabsTrigger value="journey">Onboarding Journey</TabsTrigger>
        </TabsList>

        <TabsContent value="skilltree">
          <div className="h-[600px] w-full overflow-hidden rounded-2xl border border-border bg-card">
            <SkillTreePixiView
              tree={SAMPLE_TREE}
              onOpenLecture={(id) => console.log('open lecture', id)}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Drag to pan · scroll to zoom · click a lecture node.</p>
        </TabsContent>

        <TabsContent value="match">
          <div className="h-[600px] w-full overflow-hidden rounded-2xl border border-border bg-card">
            <PracticeMatchGame questions={SAMPLE_QUESTIONS} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Drag each answer onto the matching prompt.</p>
        </TabsContent>

        <TabsContent value="journey">
          <div className="h-[220px] w-full overflow-hidden rounded-2xl border border-border bg-card">
            <OnboardingJourneyMap current={step} total={5} labels={STEP_LABELS} height={220} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(1, s - 1))}>
              Back
            </Button>
            <span className="text-sm text-foreground">Step {step} / 5</span>
            <Button size="sm" onClick={() => setStep((s) => Math.min(5, s + 1))}>
              Next
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
