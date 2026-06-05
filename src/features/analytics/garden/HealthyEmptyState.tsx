import { motion } from 'framer-motion';
import { Leaf } from 'lucide-react';

/** Shown when no insight crosses a detector's gates — the calm, all-clear state. */
export function HealthyEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-panel rounded-3xl border border-teal-500/20 px-10 py-16 text-center"
    >
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/10">
        <Leaf className="h-7 w-7 text-teal-300" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">This lecture looks healthy.</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Nothing needs your attention right now. As students work through the material, anything worth a
        closer look will surface here.
      </p>
    </motion.div>
  );
}
