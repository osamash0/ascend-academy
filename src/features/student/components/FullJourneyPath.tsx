import { useState } from 'react';
import { useTheme } from '@/lib/theme';
import { PixiStage, type PixiStageHandle, readPixiPalette } from '@/lib/pixi';
import { createFullJourneyScene, type JourneyNode, type ThemePalette } from '../pixi/fullJourneyScene';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

interface FullJourneyPathProps {
  nodes: JourneyNode[];
  className?: string;
}

export function FullJourneyPath({ nodes, className }: FullJourneyPathProps) {
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

      <Sheet open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selectedNode?.label}</SheetTitle>
            <SheetDescription className="capitalize">
              Status: {selectedNode?.status}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 text-sm text-foreground">
            <p>
              Welcome to the detailed view for <strong>{selectedNode?.label}</strong>.
            </p>
            <p className="text-muted-foreground">
              This panel contains mock details for the selected journey node.
              In a complete implementation, this would show course content,
              progress metrics, and actions to continue learning.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
