/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IChatEditorOptions } from '../widgetHosts/editor/chatEditor.js';
import { IAgentSessionsService } from './agentSessionsService.js';
import { openSession } from './agentSessionsOpener.js';

const listAgentSessionsCommandId = '_openvscode.agentSessions.list';
const openAgentSessionEditorCommandId = '_openvscode.agentSessions.openEditor';

interface IOpenVSCodeAgentSessionDto {
	readonly resource: string;
	readonly label: string;
	readonly providerType: string;
	readonly providerLabel: string;
	readonly status: number;
	readonly archived: boolean;
	readonly created: number;
	readonly lastRequestStarted?: number;
	readonly lastRequestEnded?: number;
}

CommandsRegistry.registerCommand(listAgentSessionsCommandId, async accessor => {
	const agentSessionsService = accessor.get(IAgentSessionsService);
	await agentSessionsService.model.resolve(undefined);

	return agentSessionsService.model.sessions.map((session): IOpenVSCodeAgentSessionDto => ({
		resource: session.resource.toString(),
		label: session.label,
		providerType: session.providerType,
		providerLabel: session.providerLabel,
		status: session.status,
		archived: session.isArchived(),
		created: session.timing.created,
		lastRequestStarted: session.timing.lastRequestStarted,
		lastRequestEnded: session.timing.lastRequestEnded,
	}));
});

CommandsRegistry.registerCommand(openAgentSessionEditorCommandId, async (accessor, resource: string, title?: string): Promise<boolean> => {
	if (typeof resource !== 'string') {
		return false;
	}

	const agentSessionsService = accessor.get(IAgentSessionsService);
	await agentSessionsService.model.resolve(undefined);

	const session = agentSessionsService.getSession(URI.parse(resource));
	if (!session) {
		return false;
	}

	const editorOptions: IChatEditorOptions = typeof title === 'string' && title.length > 0
		? { title: { preferred: title } }
		: {};
	await openSession(accessor, session, { sideBySide: true, editorOptions });
	return true;
});
