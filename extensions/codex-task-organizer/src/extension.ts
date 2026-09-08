/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const LIST_SESSIONS_COMMAND = '_openvscode.agentSessions.list';
const OPEN_SESSION_COMMAND = '_openvscode.agentSessions.openEditor';
const VIEW_ID = 'codexTaskOrganizer.projects';
const STATE_KEY = 'codexTaskOrganizer.state';
const DRAG_MIME_TYPE = 'application/vnd.code.tree.codextaskorganizer.projects';

interface AgentSessionDto {
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

interface Project {
	readonly id: string;
	name: string;
	readonly createdAt: number;
}

type TaskStatus = 'todo' | 'doing' | 'done';

interface TaskMetadata {
	projectId?: string;
	displayName?: string;
	status?: TaskStatus;
}

interface OrganizerState {
	readonly version: 1;
	projects: Project[];
	tasks: Record<string, TaskMetadata>;
}

interface ProjectNode {
	readonly kind: 'project';
	readonly project?: Project;
	readonly unassigned: boolean;
}

interface TaskNode {
	readonly kind: 'task';
	readonly session: AgentSessionDto;
}

type OrganizerNode = ProjectNode | TaskNode;

class OrganizerStore {
	private state: OrganizerState;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.state = context.globalState.get<OrganizerState>(STATE_KEY) ?? {
			version: 1,
			projects: [],
			tasks: {},
		};
	}

	get projects(): readonly Project[] {
		return this.state.projects;
	}

	getTask(resource: string): TaskMetadata {
		return this.state.tasks[resource] ?? {};
	}

	async createProject(name: string): Promise<Project> {
		const project: Project = {
			id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
			name,
			createdAt: Date.now(),
		};
		this.state.projects.push(project);
		await this.save();
		return project;
	}

	async renameProject(projectId: string, name: string): Promise<void> {
		const project = this.state.projects.find(candidate => candidate.id === projectId);
		if (project) {
			project.name = name;
			await this.save();
		}
	}

	async deleteProject(projectId: string): Promise<void> {
		this.state.projects = this.state.projects.filter(project => project.id !== projectId);
		for (const metadata of Object.values(this.state.tasks)) {
			if (metadata.projectId === projectId) {
				delete metadata.projectId;
			}
		}
		await this.save();
	}

	async updateTask(resource: string, update: Partial<TaskMetadata>): Promise<void> {
		const metadata = this.state.tasks[resource] ?? {};
		this.state.tasks[resource] = { ...metadata, ...update };
		if (Object.prototype.hasOwnProperty.call(update, 'projectId') && update.projectId === undefined) {
			delete this.state.tasks[resource].projectId;
		}
		if (Object.prototype.hasOwnProperty.call(update, 'displayName') && update.displayName === undefined) {
			delete this.state.tasks[resource].displayName;
		}
		if (Object.prototype.hasOwnProperty.call(update, 'status') && update.status === undefined) {
			delete this.state.tasks[resource].status;
		}
		await this.save();
	}

	private async save(): Promise<void> {
		await this.context.globalState.update(STATE_KEY, this.state);
	}
}

class OrganizerTreeDataProvider implements vscode.TreeDataProvider<OrganizerNode>, vscode.TreeDragAndDropController<OrganizerNode> {
	readonly dragMimeTypes = [DRAG_MIME_TYPE];
	readonly dropMimeTypes = [DRAG_MIME_TYPE];

	private readonly changeEmitter = new vscode.EventEmitter<OrganizerNode | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private sessions: AgentSessionDto[] = [];
	private lastError: string | undefined;

	constructor(private readonly store: OrganizerStore) { }

	dispose(): void {
		this.changeEmitter.dispose();
	}

	async refresh(): Promise<void> {
		try {
			const sessions = await vscode.commands.executeCommand<AgentSessionDto[]>(LIST_SESSIONS_COMMAND);
			this.sessions = this.filterSessions(sessions ?? []);
			this.lastError = undefined;
		} catch (error) {
			this.sessions = [];
			this.lastError = error instanceof Error ? error.message : String(error);
		}
		this.changeEmitter.fire(undefined);
	}

	getTreeItem(element: OrganizerNode): vscode.TreeItem {
		if (element.kind === 'project') {
			const label = element.unassigned ? vscode.l10n.t('Unassigned') : element.project?.name ?? '';
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = element.unassigned ? 'codexTaskOrganizer.unassigned' : 'codexTaskOrganizer.project';
			item.iconPath = new vscode.ThemeIcon(element.unassigned ? 'inbox' : 'folder');
			item.id = element.unassigned ? 'codex-project-unassigned' : `codex-project-${element.project?.id}`;
			return item;
		}

		const metadata = this.store.getTask(element.session.resource);
		const label = metadata.displayName || element.session.label;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.id = `codex-task-${element.session.resource}`;
		item.contextValue = metadata.displayName ? 'codexTaskOrganizer.taskCustomName' : 'codexTaskOrganizer.task';
		item.iconPath = this.getTaskIcon(element.session, metadata.status);
		item.description = this.getTaskDescription(element.session, metadata.status);
		item.tooltip = `${label}\n${element.session.providerLabel}\n${element.session.resource}`;
		item.command = {
			command: 'codexTaskOrganizer.openTask',
			title: vscode.l10n.t('Open Task as Editor'),
			arguments: [element],
		};
		return item;
	}

	getChildren(element?: OrganizerNode): OrganizerNode[] {
		if (!element) {
			if (this.lastError) {
				const errorSession: AgentSessionDto = {
					resource: '',
					label: vscode.l10n.t('Unable to load chat sessions: {0}', this.lastError),
					providerType: '',
					providerLabel: '',
					status: 0,
					archived: false,
					created: 0,
				};
				return [{ kind: 'task', session: errorSession }];
			}

			const projectNodes: ProjectNode[] = this.store.projects.map(project => ({ kind: 'project', project, unassigned: false }));
			if (this.getSessionsForProject(undefined).length > 0) {
				projectNodes.push({ kind: 'project', unassigned: true });
			}
			return projectNodes;
		}

		if (element.kind === 'task') {
			return [];
		}

		return this.getSessionsForProject(element.unassigned ? undefined : element.project?.id)
			.map(session => ({ kind: 'task', session }));
	}

	async handleDrag(source: readonly OrganizerNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
		const resources = source
			.filter((node): node is TaskNode => node.kind === 'task' && !!node.session.resource)
			.map(node => node.session.resource);
		if (resources.length > 0) {
			dataTransfer.set(DRAG_MIME_TYPE, new vscode.DataTransferItem(JSON.stringify(resources)));
		}
	}

	async handleDrop(target: OrganizerNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
		if (!target || target.kind !== 'project') {
			return;
		}

		const item = dataTransfer.get(DRAG_MIME_TYPE);
		if (!item) {
			return;
		}

		let resources: unknown;
		try {
			resources = JSON.parse(await item.asString());
		} catch {
			return;
		}
		if (!Array.isArray(resources) || resources.some(resource => typeof resource !== 'string')) {
			return;
		}
		for (const resource of resources) {
			await this.store.updateTask(resource, { projectId: target.unassigned ? undefined : target.project?.id });
		}
		this.changeEmitter.fire(undefined);
	}

	fireChanged(): void {
		this.changeEmitter.fire(undefined);
	}

	private filterSessions(sessions: AgentSessionDto[]): AgentSessionDto[] {
		const configuration = vscode.workspace.getConfiguration('codexTaskOrganizer');
		const providerFilter = configuration.get<string>('providerFilter', 'codex').trim().toLocaleLowerCase();
		const showArchived = configuration.get<boolean>('showArchived', false);

		return sessions
			.filter(session => showArchived || !session.archived)
			.filter(session => !providerFilter || session.providerType.toLocaleLowerCase().includes(providerFilter) || session.providerLabel.toLocaleLowerCase().includes(providerFilter))
			.sort((left, right) => this.getLastActivity(right) - this.getLastActivity(left));
	}

	private getSessionsForProject(projectId: string | undefined): AgentSessionDto[] {
		const validProjectIds = new Set(this.store.projects.map(project => project.id));
		return this.sessions.filter(session => {
			const assignedProjectId = this.store.getTask(session.resource).projectId;
			if (projectId) {
				return assignedProjectId === projectId;
			}
			return !assignedProjectId || !validProjectIds.has(assignedProjectId);
		});
	}

	private getLastActivity(session: AgentSessionDto): number {
		return session.lastRequestEnded ?? session.lastRequestStarted ?? session.created;
	}

	private getTaskIcon(session: AgentSessionDto, status: TaskStatus | undefined): vscode.ThemeIcon {
		if (session.status === 2) {
			return new vscode.ThemeIcon('sync~spin');
		}
		if (session.status === 3) {
			return new vscode.ThemeIcon('question');
		}
		if (session.status === 0) {
			return new vscode.ThemeIcon('error');
		}
		if (status === 'done') {
			return new vscode.ThemeIcon('pass-filled');
		}
		if (status === 'doing') {
			return new vscode.ThemeIcon('play-circle');
		}
		return new vscode.ThemeIcon('circle-outline');
	}

	private getTaskDescription(session: AgentSessionDto, status: TaskStatus | undefined): string {
		const statusLabel = status === 'done'
			? vscode.l10n.t('Done')
			: status === 'doing'
				? vscode.l10n.t('Doing')
				: vscode.l10n.t('Todo');
		return `${statusLabel} · ${session.providerLabel}`;
	}
}

function isProjectNode(node: OrganizerNode | undefined): node is ProjectNode & { project: Project } {
	return node?.kind === 'project' && !node.unassigned && !!node.project;
}

function isTaskNode(node: OrganizerNode | undefined): node is TaskNode {
	return node?.kind === 'task' && !!node.session.resource;
}

function hasDuplicateProjectName(store: OrganizerStore, name: string, exceptProjectId?: string): boolean {
	return store.projects.some(project => project.id !== exceptProjectId && project.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const store = new OrganizerStore(context);
	const provider = new OrganizerTreeDataProvider(store);
	const view = vscode.window.createTreeView(VIEW_ID, {
		treeDataProvider: provider,
		dragAndDropController: provider,
		showCollapseAll: true,
		canSelectMany: true,
	});
	context.subscriptions.push(provider, view);

	let refreshHandle: ReturnType<typeof setInterval> | undefined;
	const updateRefreshTimer = () => {
		if (refreshHandle) {
			clearInterval(refreshHandle);
			refreshHandle = undefined;
		}
		const refreshInterval = vscode.workspace.getConfiguration('codexTaskOrganizer').get<number>('refreshInterval', 15);
		if (refreshInterval > 0) {
			refreshHandle = setInterval(() => void provider.refresh(), refreshInterval * 1000);
		}
	};
	context.subscriptions.push({ dispose: () => refreshHandle && clearInterval(refreshHandle) });

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.refresh', () => provider.refresh()));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.createProject', async () => {
		const name = await vscode.window.showInputBox({
			prompt: vscode.l10n.t('Project name'),
			validateInput: value => !value.trim()
				? vscode.l10n.t('Enter a project name.')
				: hasDuplicateProjectName(store, value.trim())
					? vscode.l10n.t('A project with this name already exists.')
					: undefined,
		});
		if (name?.trim()) {
			await store.createProject(name.trim());
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.renameProject', async (node: OrganizerNode | undefined) => {
		if (!isProjectNode(node)) {
			return;
		}
		const name = await vscode.window.showInputBox({
			prompt: vscode.l10n.t('New project name'),
			value: node.project.name,
			validateInput: value => !value.trim()
				? vscode.l10n.t('Enter a project name.')
				: hasDuplicateProjectName(store, value.trim(), node.project.id)
					? vscode.l10n.t('A project with this name already exists.')
					: undefined,
		});
		if (name?.trim()) {
			await store.renameProject(node.project.id, name.trim());
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.deleteProject', async (node: OrganizerNode | undefined) => {
		if (!isProjectNode(node)) {
			return;
		}
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t("Delete project '{0}'? Its tasks will move to Unassigned.", node.project.name),
			{ modal: true },
			vscode.l10n.t('Delete')
		);
		if (choice === vscode.l10n.t('Delete')) {
			await store.deleteProject(node.project.id);
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.openTask', async (node: OrganizerNode | undefined) => {
		if (!isTaskNode(node)) {
			return;
		}
		const metadata = store.getTask(node.session.resource);
		const opened = await vscode.commands.executeCommand<boolean>(OPEN_SESSION_COMMAND, node.session.resource, metadata.displayName);
		if (!opened) {
			void vscode.window.showErrorMessage(vscode.l10n.t('The chat session is no longer available. Refresh the task list and try again.'));
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.renameTask', async (node: OrganizerNode | undefined) => {
		if (!isTaskNode(node)) {
			return;
		}
		const metadata = store.getTask(node.session.resource);
		const name = await vscode.window.showInputBox({
			prompt: vscode.l10n.t('Task display name'),
			value: metadata.displayName ?? node.session.label,
		});
		if (name?.trim()) {
			await store.updateTask(node.session.resource, { displayName: name.trim() });
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.resetTaskName', async (node: OrganizerNode | undefined) => {
		if (isTaskNode(node)) {
			await store.updateTask(node.session.resource, { displayName: undefined });
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.moveTask', async (node: OrganizerNode | undefined) => {
		if (!isTaskNode(node)) {
			return;
		}
		const choices = [
			{ label: vscode.l10n.t('Unassigned'), projectId: undefined },
			...store.projects.map(project => ({ label: project.name, projectId: project.id })),
		];
		const selected = await vscode.window.showQuickPick(choices, { placeHolder: vscode.l10n.t('Select a project') });
		if (selected) {
			await store.updateTask(node.session.resource, { projectId: selected.projectId });
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('codexTaskOrganizer.setTaskStatus', async (node: OrganizerNode | undefined) => {
		if (!isTaskNode(node)) {
			return;
		}
		const choices: Array<{ label: string; status: TaskStatus }> = [
			{ label: vscode.l10n.t('Todo'), status: 'todo' },
			{ label: vscode.l10n.t('Doing'), status: 'doing' },
			{ label: vscode.l10n.t('Done'), status: 'done' },
		];
		const selected = await vscode.window.showQuickPick(choices, { placeHolder: vscode.l10n.t('Select task status') });
		if (selected) {
			await store.updateTask(node.session.resource, { status: selected.status });
			provider.fireChanged();
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('codexTaskOrganizer')) {
			if (event.affectsConfiguration('codexTaskOrganizer.refreshInterval')) {
				updateRefreshTimer();
			}
			void provider.refresh();
		}
	}));

	updateRefreshTimer();
	await provider.refresh();
}

export function deactivate(): void { }
