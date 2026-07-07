import * as THREE from 'three';
import { URDFEditUtils } from '../utils/URDFEditUtils.js';

export class EndEffectorEditorController {
    constructor({ sceneManager, modelGraphView, codeEditorManager }) {
        this.sceneManager = sceneManager;
        this.modelGraphView = modelGraphView;
        this.codeEditorManager = codeEditorManager;
        this.model = null;
        this.selectedLinkName = null;
        this.previewLinks = new Set();
        this.previewMaterials = new Map();
        this.hiddenSubtreeLinks = new Set();
        this.pendingDeleteSignature = null;
        this.pendingDeleteTimer = null;
        this.pendingSelectLinkName = null;

        this.panel = document.getElementById('floating-editor-panel');
        this.bindUI();
        this.updatePanel();
    }

    setModel(model) {
        this.clearPreview();
        this.hiddenSubtreeLinks.clear();
        this.resetDeleteConfirmation();
        this.model = model;
        this.selectedLinkName = null;
        if (this.pendingSelectLinkName && model?.links?.has(this.pendingSelectLinkName)) {
            const linkName = this.pendingSelectLinkName;
            this.pendingSelectLinkName = null;
            this.selectLink(linkName, { scrollToCode: false, source: 'reload' });
            return;
        }
        this.pendingSelectLinkName = null;
        this.updatePanel();
    }

    bindUI() {
        document.getElementById('subtree-preview-btn')?.addEventListener('click', () => this.previewSubtree());
        document.getElementById('subtree-hide-btn')?.addEventListener('click', () => this.hideSubtree());
        document.getElementById('subtree-restore-btn')?.addEventListener('click', () => this.restoreHiddenSubtree());
        document.getElementById('subtree-delete-btn')?.addEventListener('click', () => this.deleteSubtree());
        document.getElementById('add-child-link-btn')?.addEventListener('click', () => this.addChildLink());
        document.getElementById('add-tcp-btn')?.addEventListener('click', () => this.addTCPLink());
        document.getElementById('export-urdf-btn')?.addEventListener('click', () => this.exportURDF());
        this.bindPoseControls();
    }

    selectLink(linkName, options = {}) {
        if (!this.model || !linkName || !this.model.links?.has(linkName)) {
            return;
        }

        if (this.selectedLinkName !== linkName) {
            this.resetDeleteConfirmation();
        }
        this.selectedLinkName = linkName;
        const link = this.model.links.get(linkName);

        if (this.sceneManager) {
            this.sceneManager.highlightManager.clearHighlight();
            this.sceneManager.highlightManager.highlightLink(link, this.model);
        }

        if (this.modelGraphView) {
            this.modelGraphView.selectLinkByName(linkName);
        }

        if (options.scrollToCode !== false && this.codeEditorManager) {
            this.codeEditorManager.scrollToLink(linkName);
        }

        this.syncDefaultChildNames();
        this.showPanel();
        this.updatePanel();
    }

    clearSelection() {
        this.selectedLinkName = null;
        this.clearPreview();
        this.resetDeleteConfirmation();
        this.updatePanel();
    }

    findLinkNameFromObject(object) {
        let current = object;
        while (current) {
            if ((current.isURDFLink || current.type === 'URDFLink') && current.name && this.model?.links?.has(current.name)) {
                return current.name;
            }
            current = current.parent;
        }
        return null;
    }

    getParentJoint(linkName) {
        if (!this.model?.joints) return null;
        for (const [jointName, joint] of this.model.joints.entries()) {
            if (joint.child === linkName) {
                return { ...joint, name: joint.name || jointName };
            }
        }
        return null;
    }

    getChildJoints(linkName) {
        if (!this.model?.joints || !linkName) return [];
        return Array.from(this.model.joints.entries())
            .filter(([, joint]) => joint.parent === linkName)
            .map(([jointName, joint]) => ({ ...joint, name: joint.name || jointName }));
    }

    getRootLinkName() {
        if (!this.model) return null;
        if (this.model.rootLink?.name) return this.model.rootLink.name;

        const childLinks = new Set();
        this.model.joints?.forEach(joint => {
            if (joint.child) childLinks.add(joint.child);
        });

        for (const linkName of this.model.links?.keys?.() || []) {
            if (!childLinks.has(linkName)) return linkName;
        }
        return null;
    }

    getDescendantSubtree(linkName) {
        const links = new Set();
        const joints = new Set();

        const visit = (parentLinkName) => {
            this.model.joints.forEach((joint, jointName) => {
                if (joint.parent === parentLinkName && joint.child) {
                    joints.add(jointName);
                    links.add(joint.child);
                    visit(joint.child);
                }
            });
        };

        if (this.model?.joints && linkName) {
            visit(linkName);
        }

        return { links, joints };
    }

    setStatus(message, type = 'info') {
        const status = document.getElementById('editor-action-status');
        if (!status) return;
        status.textContent = message;
        status.className = `editor-action-status ${type}`;
    }

    getPoseConfig(target) {
        const configs = {
            child: {
                xyzId: 'child-origin-xyz',
                rpyId: 'child-origin-rpy',
                previewId: 'child-pose-preview',
                distanceId: 'child-distance-mm',
                angleId: 'child-angle-deg',
                segmentLengthId: 'child-segment-length',
                segmentRpyId: 'child-segment-rpy',
                directPanelId: 'child-direct-panel',
                guidedPanelId: 'child-guided-panel'
            },
            tcp: {
                xyzId: 'tcp-origin-xyz',
                rpyId: 'tcp-origin-rpy',
                previewId: 'tcp-pose-preview',
                distanceId: 'tcp-distance-mm',
                angleId: 'tcp-angle-deg',
                directPanelId: 'tcp-direct-panel',
                guidedPanelId: 'tcp-guided-panel'
            }
        };
        return configs[target] || null;
    }

    bindPoseControls() {
        ['child', 'tcp'].forEach(target => {
            const config = this.getPoseConfig(target);
            if (!config) return;

            [config.xyzId, config.rpyId].forEach(id => {
                document.getElementById(id)?.addEventListener('input', () => this.updatePosePreview(target));
            });

            document.querySelectorAll(`[data-pose-target="${target}"][data-pose-mode]`).forEach(button => {
                button.addEventListener('click', () => this.setPoseMode(target, button.dataset.poseMode));
            });
        });

        document.querySelectorAll('[data-pose-target][data-pose-axis], [data-pose-target][data-pose-rotation]').forEach(button => {
            button.addEventListener('click', () => this.applyGuidedPoseStep(button));
        });

        document.getElementById('child-apply-segment-btn')?.addEventListener('click', () => this.applyGuidedSegment());

        this.updatePosePreview('child');
        this.updatePosePreview('tcp');
    }

    parseTripletValue(value, label) {
        const parts = String(value || '').trim().split(/\s+/);
        if (parts.length !== 3) {
            throw new Error(`${label} must contain three numbers.`);
        }
        const numbers = parts.map(part => Number(part));
        if (numbers.some(number => !Number.isFinite(number))) {
            throw new Error(`${label} must contain three finite numbers.`);
        }
        return numbers;
    }

    formatPoseNumber(value) {
        if (Math.abs(value) < 1e-12) return '0';
        return Number(value.toFixed(8)).toString();
    }

    formatTriplet(values) {
        return values.map(value => this.formatPoseNumber(value)).join(' ');
    }

    readPoseValues(target) {
        const config = this.getPoseConfig(target);
        if (!config) {
            throw new Error(`Unknown pose target: ${target}`);
        }
        const xyzInput = document.getElementById(config.xyzId);
        const rpyInput = document.getElementById(config.rpyId);
        return {
            config,
            xyz: this.parseTripletValue(xyzInput?.value || '0 0 0', 'xyz'),
            rpy: this.parseTripletValue(rpyInput?.value || '0 0 0', 'rpy')
        };
    }

    writePoseValues(target, xyz, rpy) {
        const config = this.getPoseConfig(target);
        if (!config) return;

        const xyzInput = document.getElementById(config.xyzId);
        const rpyInput = document.getElementById(config.rpyId);
        if (xyzInput) xyzInput.value = this.formatTriplet(xyz);
        if (rpyInput) rpyInput.value = this.formatTriplet(rpy);
        this.updatePosePreview(target);
    }

    updatePosePreview(target) {
        const config = this.getPoseConfig(target);
        const preview = config ? document.getElementById(config.previewId) : null;
        if (!preview) return;

        try {
            const { xyz, rpy } = this.readPoseValues(target);
            preview.textContent = `xyz ${this.formatTriplet(xyz)} | rpy ${this.formatTriplet(rpy)}`;
            preview.classList.remove('error');
        } catch (error) {
            preview.textContent = `Invalid pose: ${error.message}`;
            preview.classList.add('error');
        }
    }

    setPoseMode(target, mode) {
        const config = this.getPoseConfig(target);
        if (!config) return;

        document.querySelectorAll(`[data-pose-target="${target}"][data-pose-mode]`).forEach(button => {
            button.classList.toggle('active', button.dataset.poseMode === mode);
        });

        document.getElementById(config.directPanelId)?.classList.toggle('hidden', mode !== 'direct');
        document.getElementById(config.guidedPanelId)?.classList.toggle('active', mode === 'guided');
        this.updatePosePreview(target);
    }

    readPositiveStep(inputId, label) {
        const input = document.getElementById(inputId);
        const value = Number(input?.value);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${label} must be a positive number.`);
        }
        return value;
    }

    applyGuidedPoseStep(button) {
        const target = button.dataset.poseTarget;
        const sign = Number(button.dataset.poseSign || '1');
        const config = this.getPoseConfig(target);
        if (!config) return;

        try {
            const { xyz, rpy } = this.readPoseValues(target);
            if (button.dataset.poseAxis) {
                const distanceM = this.readPositiveStep(config.distanceId, 'Translation distance') / 1000;
                const axisIndex = { x: 0, y: 1, z: 2 }[button.dataset.poseAxis];
                xyz[axisIndex] += sign * distanceM;
            }
            if (button.dataset.poseRotation) {
                const angleRad = this.readPositiveStep(config.angleId, 'Rotation angle') * Math.PI / 180;
                const rotationIndex = { roll: 0, pitch: 1, yaw: 2 }[button.dataset.poseRotation];
                rpy[rotationIndex] += sign * angleRad;
            }
            this.writePoseValues(target, xyz, rpy);
        } catch (error) {
            this.setStatus(error.message, 'error');
            this.updatePosePreview(target);
        }
    }

    applyGuidedSegment() {
        const config = this.getPoseConfig('child');
        if (!config) return;

        try {
            const length = this.readPositiveStep(config.segmentLengthId, 'Segment length');
            const rpyInput = document.getElementById(config.segmentRpyId);
            const rpy = this.parseTripletValue(rpyInput?.value || '0 0 0', 'Segment rpy');
            const [, pitch, yaw] = rpy;
            const xyz = [
                length * Math.cos(yaw) * Math.cos(pitch),
                length * Math.sin(yaw) * Math.cos(pitch),
                -length * Math.sin(pitch)
            ];

            this.writePoseValues('child', xyz, rpy);
            this.setStatus(`Applied segment pose: xyz ${this.formatTriplet(xyz)} | rpy ${this.formatTriplet(rpy)}.`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    showPanel() {
        if (!this.panel) return;
        this.panel.style.display = '';
        this.panel.style.opacity = '';
        this.panel.style.transform = '';
        document.getElementById('toggle-editor-panel')?.classList.add('active');
    }

    syncDefaultChildNames() {
        if (!this.selectedLinkName) return;
        const jointInput = document.getElementById('child-joint-name');
        const linkInput = document.getElementById('child-link-name');
        if (jointInput && (!jointInput.dataset.touched || jointInput.dataset.parentLink !== this.selectedLinkName)) {
            jointInput.value = `${this.selectedLinkName}_fixed_joint`;
            jointInput.dataset.parentLink = this.selectedLinkName;
            jointInput.dataset.touched = '';
        }
        if (linkInput && (!linkInput.dataset.touched || linkInput.dataset.parentLink !== this.selectedLinkName)) {
            linkInput.value = `${this.selectedLinkName}_child_link`;
            linkInput.dataset.parentLink = this.selectedLinkName;
            linkInput.dataset.touched = '';
        }
        [jointInput, linkInput].forEach(input => {
            if (!input || input.dataset.boundTouched) return;
            input.addEventListener('input', () => {
                input.dataset.touched = 'true';
            });
            input.dataset.boundTouched = 'true';
        });
    }

    updatePanel() {
        const selected = document.getElementById('selected-link-name');
        const joint = document.getElementById('selected-parent-joint');
        const type = document.getElementById('selected-parent-joint-type');
        const childJointsEl = document.getElementById('selected-child-joints');
        const subtree = document.getElementById('selected-subtree-summary');
        const list = document.getElementById('selected-subtree-list');
        const buttons = [
            'subtree-preview-btn',
            'subtree-hide-btn',
            'subtree-restore-btn',
            'subtree-delete-btn',
            'add-child-link-btn',
            'add-tcp-btn',
            'export-urdf-btn'
        ];

        const hasModel = Boolean(this.model);
        const hasSelection = Boolean(this.selectedLinkName);
        const rootLinkName = this.getRootLinkName();

        if (selected) selected.textContent = hasSelection ? this.selectedLinkName : 'None';

        const parentJoint = hasSelection ? this.getParentJoint(this.selectedLinkName) : null;
        if (joint) joint.textContent = parentJoint?.name || 'None';
        if (type) type.textContent = parentJoint?.type || 'base';
        const childJoints = hasSelection ? this.getChildJoints(this.selectedLinkName) : [];
        if (childJointsEl) {
            childJointsEl.textContent = childJoints.length > 0
                ? childJoints.map(childJoint => childJoint.name).join(', ')
                : 'None';
        }

        const descendant = hasSelection ? this.getDescendantSubtree(this.selectedLinkName) : { links: new Set(), joints: new Set() };
        const hasDescendants = descendant.links.size > 0;
        const isRootSelection = hasSelection && this.selectedLinkName === rootLinkName;
        if (subtree) {
            subtree.textContent = hasSelection
                ? `${descendant.links.size} links, ${descendant.joints.size} joints`
                : 'Select a link in the 3D view or structure tree.';
        }
        if (list) {
            const names = Array.from(descendant.links);
            list.textContent = names.length > 0 ? names.slice(0, 12).join(', ') + (names.length > 12 ? ' ...' : '') : 'No descendants';
        }

        buttons.forEach(id => {
            const button = document.getElementById(id);
            if (!button) return;
            if (id === 'export-urdf-btn') {
                button.disabled = !hasModel;
            } else if (id === 'subtree-restore-btn') {
                button.disabled = this.hiddenSubtreeLinks.size === 0;
            } else if (id === 'subtree-delete-btn') {
                button.disabled = !hasSelection || !hasDescendants || isRootSelection;
            } else if (id === 'subtree-preview-btn' || id === 'subtree-hide-btn') {
                button.disabled = !hasSelection || !hasDescendants;
            } else {
                button.disabled = !hasSelection;
            }
        });

        if (!hasModel) {
            this.setStatus('Load a URDF model to edit.', 'info');
        } else if (!hasSelection) {
            this.setStatus('Select a mount or wrist link.', 'info');
        } else if (isRootSelection) {
            this.setStatus('Root link selected. Trim after this link is disabled.', 'warning');
        } else if (!hasDescendants) {
            this.setStatus('Selected link has no descendants to trim, preview, or hide.', 'info');
        }
    }

    forEachLinkMesh(linkName, callback) {
        const link = this.model?.links?.get(linkName);
        if (!link?.threeObject) return;

        link.threeObject.traverse(child => {
            if (child.isMesh) {
                let current = child;
                while (current) {
                    if (current.isURDFCollider || current.userData?.isCollision) {
                        return;
                    }
                    current = current.parent;
                }
                callback(child);
            }
        });
    }

    clearPreview() {
        this.previewMaterials.forEach((material, mesh) => {
            mesh.material = material;
        });
        this.previewMaterials.clear();
        this.previewLinks.clear();
        this.sceneManager?.redraw();
    }

    resetDeleteConfirmation() {
        this.pendingDeleteSignature = null;
        if (this.pendingDeleteTimer) {
            clearTimeout(this.pendingDeleteTimer);
            this.pendingDeleteTimer = null;
        }
        const deleteButton = document.getElementById('subtree-delete-btn');
        if (deleteButton) {
            deleteButton.textContent = 'Trim after this link';
            deleteButton.classList.remove('confirming');
        }
    }

    previewSubtree() {
        if (!this.selectedLinkName) return;

        if (this.previewLinks.size > 0) {
            this.clearPreview();
            this.setStatus('Subtree preview cleared.', 'info');
            return;
        }

        const { links } = this.getDescendantSubtree(this.selectedLinkName);
        if (links.size === 0) {
            this.setStatus('Selected link has no descendants to preview.', 'warning');
            return;
        }

        const previewMaterial = new THREE.MeshPhongMaterial({
            color: 0xffb000,
            emissive: 0xff6a00,
            emissiveIntensity: 0.35,
            transparent: true,
            opacity: 0.72
        });

        links.forEach(linkName => {
            this.forEachLinkMesh(linkName, mesh => {
                if (!this.previewMaterials.has(mesh)) {
                    this.previewMaterials.set(mesh, mesh.material);
                    mesh.material = previewMaterial;
                }
            });
            this.previewLinks.add(linkName);
        });

        this.setStatus(`Previewing ${links.size} descendant links that would be trimmed.`, 'success');
        this.sceneManager?.redraw();
    }

    hideSubtree() {
        if (!this.selectedLinkName) return;
        const { links } = this.getDescendantSubtree(this.selectedLinkName);
        if (links.size === 0) {
            this.setStatus('Selected link has no descendants to hide.', 'warning');
            return;
        }

        this.clearPreview();
        links.forEach(linkName => {
            const link = this.model.links.get(linkName);
            if (link?.threeObject) {
                link.threeObject.visible = false;
                this.hiddenSubtreeLinks.add(linkName);
            }
        });

        this.setStatus(`Hidden ${links.size} descendant links in the viewer.`, 'success');
        this.updatePanel();
        this.sceneManager?.redraw();
    }

    restoreHiddenSubtree() {
        if (this.hiddenSubtreeLinks.size === 0) {
            this.setStatus('No hidden subtree links to restore.', 'info');
            return;
        }

        let restored = 0;
        this.hiddenSubtreeLinks.forEach(linkName => {
            const link = this.model?.links?.get(linkName);
            if (link?.threeObject) {
                link.threeObject.visible = true;
                restored++;
            }
        });

        this.hiddenSubtreeLinks.clear();
        this.setStatus(`Restored ${restored} hidden links.`, 'success');
        this.updatePanel();
        this.sceneManager?.redraw();
    }

    async deleteSubtree() {
        if (!this.selectedLinkName) return;
        if (this.selectedLinkName === this.getRootLinkName()) {
            this.setStatus('Trim after this link is disabled for the root link.', 'warning');
            return;
        }
        const { links, joints } = this.getDescendantSubtree(this.selectedLinkName);
        if (links.size === 0) {
            this.setStatus('Selected link has no descendants to trim.', 'warning');
            return;
        }

        const content = this.codeEditorManager?.getCurrentContent();
        if (!content) {
            this.setStatus('No editable URDF content is loaded.', 'error');
            return;
        }

        const signature = `${this.selectedLinkName}:${Array.from(links).join(',')}:${Array.from(joints).join(',')}`;
        const deleteButton = document.getElementById('subtree-delete-btn');
        if (this.pendingDeleteSignature !== signature) {
            this.pendingDeleteSignature = signature;
            if (deleteButton) {
                deleteButton.textContent = 'Confirm trim descendants';
                deleteButton.classList.add('confirming');
            }
            this.setStatus(`Click Confirm trim descendants to remove ${links.size} descendant links and ${joints.size} joints. Selected link stays.`, 'warning');
            this.pendingDeleteTimer = setTimeout(() => this.resetDeleteConfirmation(), 8000);
            return;
        }

        try {
            const updated = URDFEditUtils.removeSubtree(content, links, joints);
            this.clearPreview();
            this.restoreHiddenSubtree();
            this.resetDeleteConfirmation();
            await this.codeEditorManager.replaceContentAndReload(updated);
            this.setStatus(`Trimmed ${links.size} descendant links and ${joints.size} joints. Selected link was kept.`, 'success');
        } catch (error) {
            this.resetDeleteConfirmation();
            this.setStatus(error.message, 'error');
        }
    }

    readTripletInputs(xyzId, rpyId, label) {
        const xyz = document.getElementById(xyzId)?.value?.trim() || '0 0 0';
        const rpy = document.getElementById(rpyId)?.value?.trim() || '0 0 0';
        const isTriplet = value => /^[-+0-9.eE]+\s+[-+0-9.eE]+\s+[-+0-9.eE]+$/.test(value) &&
            value.split(/\s+/).every(part => Number.isFinite(Number(part)));

        if (!isTriplet(xyz)) {
            throw new Error(`${label} xyz must be three numbers, for example: 0 0 0.12`);
        }
        if (!isTriplet(rpy)) {
            throw new Error(`${label} rpy must be three numbers in radians, for example: 0 0 0`);
        }

        return { xyz, rpy };
    }

    readTCPOriginInputs() {
        return this.readTripletInputs('tcp-origin-xyz', 'tcp-origin-rpy', 'TCP');
    }

    readChildLinkInputs() {
        const jointName = document.getElementById('child-joint-name')?.value?.trim() || '';
        const linkName = document.getElementById('child-link-name')?.value?.trim() || '';
        const addVisualMarker = document.getElementById('child-add-visual-marker')?.checked !== false;
        const origin = this.readTripletInputs('child-origin-xyz', 'child-origin-rpy', 'Child link origin');

        return { jointName, linkName, addVisualMarker, ...origin };
    }

    async addChildLink() {
        if (!this.selectedLinkName) return;
        const content = this.codeEditorManager?.getCurrentContent();
        if (!content) {
            this.setStatus('No editable URDF content is loaded.', 'error');
            return;
        }

        try {
            const inputs = this.readChildLinkInputs();
            const result = URDFEditUtils.addFixedChildLink(content, this.selectedLinkName, inputs);
            this.resetDeleteConfirmation();
            this.pendingSelectLinkName = result.linkName;
            await this.codeEditorManager.replaceContentAndReload(result.xml);
            if (inputs.addVisualMarker && result.visualInfo?.skipped) {
                this.setStatus(`Added child link ${result.linkName}. Zero-length child segment: rod visual skipped.`, 'warning');
            } else {
                this.setStatus(`Added child link ${result.linkName} via fixed joint ${result.jointName}${inputs.addVisualMarker ? ' with rod visual.' : '.'}`, 'success');
            }
        } catch (error) {
            this.pendingSelectLinkName = null;
            this.setStatus(error.message, 'error');
        }
    }

    async addTCPLink() {
        if (!this.selectedLinkName) return;
        const content = this.codeEditorManager?.getCurrentContent();
        if (!content) {
            this.setStatus('No editable URDF content is loaded.', 'error');
            return;
        }

        try {
            const origin = this.readTCPOriginInputs();
            const addVisualMarker = document.getElementById('tcp-add-visual-marker')?.checked === true;
            const result = URDFEditUtils.addTCPLink(content, this.selectedLinkName, { ...origin, addVisualMarker });
            this.resetDeleteConfirmation();
            this.pendingSelectLinkName = result.linkName;
            await this.codeEditorManager.replaceContentAndReload(result.xml);
            this.setStatus(`Added ${result.linkName} via fixed joint ${result.jointName}${addVisualMarker ? ' with sphere visual marker' : ''} at xyz="${origin.xyz}" rpy="${origin.rpy}".`, 'success');
        } catch (error) {
            this.pendingSelectLinkName = null;
            this.setStatus(error.message, 'error');
        }
    }

    exportURDF() {
        if (!this.codeEditorManager) return;
        const fileName = this.codeEditorManager.getCurrentFileName('edited_robot.urdf');
        const content = this.codeEditorManager.getCurrentContent();
        const formatted = URDFEditUtils.formatXML(content);
        this.codeEditorManager.downloadContent(formatted, fileName);
        this.setStatus(`Exported ${fileName}.`, 'success');
    }
}
