import { Plugin } from '@nocobase/server';
export declare class PluginSchedulingServer extends Plugin {
    beforeLoad(): Promise<void>;
    load(): Promise<void>;
}
export default PluginSchedulingServer;
