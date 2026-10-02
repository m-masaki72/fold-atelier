const clamp = (t) => Math.max(0, Math.min(1, t));
const ease = (t) => {
  t = clamp((t - 0.12) / 0.76);
  return t * t * (3 - 2 * t);
};
export const STEP_SECONDS = 1.15;
export const END_HOLD_SECONDS = 2.2;

export function createFoldSequence(part) {
  const children = part.faces.map(() => []),
    steps = [];
  part.tree.forEach((joint, index) => children[joint.parent].push(index));
  // Close small branches before swinging their parent branch into place.
  function visit(face) {
    const movingFaces = [face];
    for (const index of children[face]) {
      const joint = part.tree[index];
      const branch = visit(joint.child);
      movingFaces.push(...branch);
      if (Math.abs(joint.angle) > 1e-7)
        steps.push({
          kind: 'hinge',
          joint: index,
          parent: joint.parent,
          child: joint.child,
          movingFaces: branch,
          name: part.faces[joint.child].name,
        });
    }
    return movingFaces;
  }
  visit(part.root);
  const poseRequired = Math.abs(part.flattenRotation.w) < 1 - 1e-9;
  if (poseRequired) steps.push({ kind: 'pose', name: '完成した姿を起こす' });
  const ranks = new Map(steps.filter((step) => step.kind === 'hinge').map((step, i) => [step.joint, i]));
  const count = steps.length;
  const sample = (progress) => {
    const position = clamp(progress) * count;
    const index = Math.min(count - 1, Math.floor(position + 1e-10));
    return {
      completed: Math.min(count, Math.floor(position + 1e-10)),
      index,
      active: position >= count ? null : steps[index],
      hingeProgress: part.tree.map((_, i) => (ranks.has(i) ? ease(position - ranks.get(i)) : 1)),
      poseProgress: poseRequired ? ease(position - count + 1) : 1,
    };
  };
  return {
    steps,
    count,
    duration: count * STEP_SECONDS,
    sample,
    target(progress, direction) {
      const position = clamp(progress) * count;
      const step = direction > 0 ? Math.floor(position + 1e-8) + 1 : Math.ceil(position - 1e-8) - 1;
      return clamp(step / count);
    },
  };
}

// Time is supplied by the caller so pause, hidden tabs, and one-frame stalls
// cannot skip a crease. Only one local hinge changes during each step.
export function advancePlayback(playback, dt, sequence, touring = false) {
  let { progress, direction, hold } = playback;
  if (hold > 0) {
    hold = Math.max(0, hold - dt);
    if (hold === 0 && progress === 1 && touring) return { progress, direction, hold, nextModel: true };
    return { progress, direction, hold, nextModel: false };
  }
  progress = clamp(progress + (direction * dt) / sequence.duration);
  if (progress === 1 || progress === 0) {
    hold = END_HOLD_SECONDS;
    direction = progress === 1 ? -1 : 1;
  }
  return { progress, direction, hold, nextModel: false };
}
