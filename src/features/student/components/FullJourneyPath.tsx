import { useState } from 'react';
import { useTheme } from '@/lib/theme';
import { PixiStage, type PixiStageHandle, readPixiPalette } from '@/lib/pixi';
import { createFullJourneyScene, type JourneyNode, type ThemePalette } from '../pixi/fullJourneyScene';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface FullJourneyPathProps {
  nodes: JourneyNode[];
  className?: string;
  onOpenLecture?: (lectureId: string) => void;
}

export function FullJourneyPath({ nodes, className, onOpenLecture }: FullJourneyPathProps) {
  const { theme } = useTheme();
  const [selectedNode, setSelectedNode] = useState<JourneyNode | null>(null);

  const handleNodeSelect = (node: JourneyNode) => {
    setSelectedNode(node);
  };

  return (
    <div className={`relative ${className || ''}`}>
      {/* Visually hidden list for keyboard/screen reader accessibility */}
      <ol className="sr-only">
        {nodes.map((node) => (
          <li key={node.id}>
            <button onClick={() => handleNodeSelect(node)}>
              {node.label} ({node.status})
            </button>
          </li>
        ))}
      </ol>

      {nodes.length === 0 ? (
        <div className="grid h-48 place-items-center rounded-2xl border border-dashed border-border bg-card px-6 text-center text-sm text-muted-foreground">
          Add a lecture to start building your learning journey.
        </div>
      ) : (
        <div className="h-[600px] w-full overflow-hidden rounded-2xl border border-border bg-card">
          <PixiStage
            className="h-full w-full"
            deps={[theme, nodes]}
            onReady={({ app }: PixiStageHandle) => {
              const rawPalette = readPixiPalette();
              const pixiTheme: ThemePalette = {
                primary: rawPalette.primary,
                secondary: rawPalette.accent || rawPalette['primary-dim'] || 0x4a90e2,
                background: rawPalette.background,
                text: rawPalette.foreground,
                locked: rawPalette.muted,
              };

              const scene = createFullJourneyScene(app, {
                nodes,
                theme: pixiTheme,
                onNodeSelect: handleNodeSelect,
              });

              app.stage.addChild(scene.root);

              return () => {
                app.stage.removeChild(scene.root);
                scene.root.destroy({ children: true });
              };
            }}
          />
        </div>
      )}

      <Sheet open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selectedNode?.label}</SheetTitle>
            <SheetDescription className="capitalize">
              Status: {selectedNode?.status}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 text-sm text-foreground">
            <p className="text-muted-foreground">
              {selectedNode?.description || (selectedNode?.status === 'locked'
                ? 'Complete the active lecture to unlock this next step.'
                : 'Open this lecture to continue your learning journey.')}
            </p>
            {selectedNode?.lectureId && selectedNode.status !== 'locked' ? (
              <Button className="w-full" onClick={() => onOpenLecture?.(selectedNode.lectureId)}>
                Open lecture
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
