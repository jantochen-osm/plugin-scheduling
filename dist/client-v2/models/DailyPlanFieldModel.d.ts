import React from 'react';
import { ClickableFieldModel } from '@nocobase/client-v2';
interface DailyPlanRecord {
    [date: string]: number;
}
export declare class DailyPlanFieldModel extends ClickableFieldModel {
    renderComponent(value: DailyPlanRecord | null): React.JSX.Element;
}
export {};
