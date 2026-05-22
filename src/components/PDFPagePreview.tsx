import React, { useState } from 'react';
import { Page } from 'react-pdf';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

interface PDFPagePreviewProps {
  pageNumber: number;
  width?: number;
  className?: string;
  onClick?: () => void;
}

export function PDFPagePreview({ pageNumber, width = 200, className, onClick }: PDFPagePreviewProps) {
  const [loading, setLoading] = useState(true);

  return (
    <div 
      className={cn(
        "relative rounded-lg overflow-hidden border border-border/50 bg-muted/20 cursor-pointer transition-all hover:scale-[1.02] hover:ring-2 hover:ring-violet-500/50 shadow-sm",
        className
      )}
      onClick={onClick}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <Page 
        pageNumber={pageNumber} 
        width={width} 
        renderTextLayer={false} 
        renderAnnotationLayer={false}
        onLoadSuccess={() => setLoading(false)}
        className="w-full h-auto"
      />
    </div>
  );
}
