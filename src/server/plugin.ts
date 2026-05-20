import { Plugin } from '@nocobase/server';
import { runScheduling } from './actions/runScheduling';
import { validateSchedule } from './actions/validateSchedule';

export class PluginSchedulingServer extends Plugin {
  async beforeLoad() {
    // Collections 通过 API 或 UI 创建，不在 beforeLoad 中注册
  }

  async load() {
    // 注册排产 API 端点
    this.app.resourceManager.define({
      name: 'scheduling',
      actions: {
        run: runScheduling,
        validate: validateSchedule,
      },
    });

    // 开放权限（MVP 阶段 loggedIn 即可）
    this.app.acl.allow('scheduling', ['run', 'validate'], 'loggedIn');
    this.app.acl.allow('schedule_runs', ['list', 'get'], 'loggedIn');
    this.app.acl.allow('schedule_results_v2', ['list', 'get'], 'loggedIn');
    this.app.acl.allow('schedule_exceptions_v2', ['list', 'get'], 'loggedIn');
  }
}

export default PluginSchedulingServer;
