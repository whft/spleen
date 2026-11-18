import * as React from 'react';

import { revalidateReferences } from '@/components/references/referenceCache';
import { subscribeSpleenEvents } from '@/lib/spleenEvents';

export function useBoardRevalidation(onScreen: boolean): void {
    React.useEffect(() => {
        if (!onScreen) return undefined;
        revalidateReferences();
        const onReturn = () => {
            if (document.visibilityState === 'visible') revalidateReferences();
        };
        window.addEventListener('focus', onReturn);
        document.addEventListener('visibilitychange', onReturn);
        const releaseEvents = subscribeSpleenEvents((event) => {
            if (event.type === 'source-control-activity') revalidateReferences();
        });
        return () => {
            window.removeEventListener('focus', onReturn);
            document.removeEventListener('visibilitychange', onReturn);
            releaseEvents();
        };
    }, [onScreen]);
}
