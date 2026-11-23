import { closestCenter, pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';

export const sessionFolderCollision: CollisionDetection = (args) => {
  const active = args.active.data.current;
  if (active?.type !== 'session') {
    const sortGroup = active?.sortGroup;
    return closestCenter(sortGroup === undefined ? args : {
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => container.data.current?.sortGroup === sortGroup),
    });
  }
  const detect = args.pointerCoordinates ? pointerWithin : rectIntersection;
  const folderCollisions = detect({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => container.data.current?.type === 'folder'),
  });
  if (folderCollisions.length > 0) {
    return folderCollisions;
  }
  return detect({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.data.current?.type === 'project' && Boolean(container.data.current?.projectDirectory),
    ),
  });
};
