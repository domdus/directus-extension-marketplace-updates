import { defineModule } from '@directus/extensions-sdk';
import { userHasAdminAccess } from '../shared/admin';
import UpdatesView from './updates-view.vue';
import { installStudioInjector } from './studio-injector';

installStudioInjector();

export default defineModule({
	id: 'extension-updates',
	name: 'Extension Updates',
	icon: 'system_update',
	hidden: true,
	routes: [
		{
			path: '',
			component: UpdatesView,
		},
	],
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
