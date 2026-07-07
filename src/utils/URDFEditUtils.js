/**
 * URDF editing helpers for structural end-effector edits.
 * These functions operate on XML DOM instead of string slicing where possible.
 */
export class URDFEditUtils {
    static parseURDF(xmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Invalid URDF XML');
        }

        const robot = doc.querySelector('robot');
        if (!robot) {
            throw new Error('URDF robot element not found');
        }

        return { doc, robot };
    }

    static serialize(doc) {
        return new XMLSerializer().serializeToString(doc);
    }

    static formatXML(xmlContent) {
        const declarationMatch = xmlContent.match(/^\s*(<\?xml[^?]*\?>)\s*/);
        const declaration = declarationMatch ? `${declarationMatch[1]}\n` : '';
        const body = declarationMatch ? xmlContent.slice(declarationMatch[0].length) : xmlContent;

        const compact = body
            .replace(/>\s+</g, '><')
            .replace(/(>)(<)(\/*)/g, '$1\n$2$3');

        let indent = 0;
        const formatted = compact.split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                if (line.match(/^<\/\w/)) {
                    indent = Math.max(indent - 1, 0);
                }

                const result = `${'  '.repeat(indent)}${line}`;

                if (line.match(/^<[^!?/][^>]*[^/]>/) && !line.match(/^<[^>]+>.*<\/[^>]+>$/)) {
                    indent++;
                }

                return result;
            })
            .join('\n');

        return `${declaration}${formatted}\n`;
    }

    static serializeFormatted(doc, originalXML = '') {
        const serialized = this.serialize(doc);
        const formatted = this.formatXML(serialized);
        if (/^\s*<\?xml/i.test(originalXML) || /^\s*<\?xml/i.test(formatted)) {
            return formatted;
        }
        return formatted.replace(/^\s*<\?xml[^?]*\?>\s*/i, '');
    }

    static removeSubtree(xmlContent, linkNames, jointNames) {
        const { doc } = this.parseURDF(xmlContent);
        const links = new Set(linkNames);
        const joints = new Set(jointNames);

        doc.querySelectorAll('joint').forEach(jointEl => {
            const name = jointEl.getAttribute('name');
            if (joints.has(name)) {
                jointEl.remove();
            }
        });

        doc.querySelectorAll('link').forEach(linkEl => {
            const name = linkEl.getAttribute('name');
            if (links.has(name)) {
                linkEl.remove();
            }
        });

        return this.serializeFormatted(doc, xmlContent);
    }

    static getExistingLinkNames(doc) {
        return new Set(Array.from(doc.querySelectorAll('link'))
            .map(link => link.getAttribute('name'))
            .filter(Boolean));
    }

    static getExistingJointNames(doc) {
        return new Set(Array.from(doc.querySelectorAll('joint'))
            .map(joint => joint.getAttribute('name'))
            .filter(Boolean));
    }

    static makeUniqueName(baseName, existingNames) {
        if (!existingNames.has(baseName)) {
            return baseName;
        }

        let index = 1;
        let candidate = `${baseName}_${index}`;
        while (existingNames.has(candidate)) {
            index++;
            candidate = `${baseName}_${index}`;
        }
        return candidate;
    }

    static assertTriplet(value, label) {
        const parts = String(value || '').trim().split(/\s+/);
        if (parts.length !== 3 || parts.some(part => !Number.isFinite(Number(part)))) {
            throw new Error(`${label} must be three numbers, for example: 0 0 0`);
        }
        return parts.join(' ');
    }

    static tripletToNumbers(value, label) {
        return this.assertTriplet(value, label).split(/\s+/).map(Number);
    }

    static formatNumber(value) {
        if (Math.abs(value) < 1e-12) return '0';
        return Number(value.toFixed(10)).toString();
    }

    static appendMarkerMaterial(doc, visualEl) {
        const materialEl = doc.createElement('material');
        materialEl.setAttribute('name', 'editor_marker_blue');

        const colorEl = doc.createElement('color');
        colorEl.setAttribute('rgba', '0.1 0.45 1.0 0.8');

        materialEl.appendChild(colorEl);
        visualEl.appendChild(materialEl);
    }

    static appendRodSegmentVisual(doc, linkEl, length) {
        const rodLength = Number(length);
        if (!Number.isFinite(rodLength) || rodLength <= 1e-9) {
            return { added: false, skipped: true, kind: 'rod' };
        }

        const visualEl = doc.createElement('visual');
        visualEl.setAttribute('name', 'editor_rod_visual');

        const originEl = doc.createElement('origin');
        originEl.setAttribute('xyz', `${this.formatNumber(-rodLength / 2)} 0 0`);
        originEl.setAttribute('rpy', '0 1.57079632679 0');

        const geometryEl = doc.createElement('geometry');
        const cylinderEl = doc.createElement('cylinder');
        cylinderEl.setAttribute('radius', '0.006');
        cylinderEl.setAttribute('length', this.formatNumber(rodLength));
        geometryEl.appendChild(cylinderEl);

        const materialEl = doc.createElement('material');
        materialEl.setAttribute('name', 'editor_rod_gray');

        const colorEl = doc.createElement('color');
        colorEl.setAttribute('rgba', '0.4 0.4 0.4 1');
        materialEl.appendChild(colorEl);

        visualEl.appendChild(originEl);
        visualEl.appendChild(geometryEl);
        visualEl.appendChild(materialEl);
        linkEl.appendChild(visualEl);

        return { added: true, skipped: false, kind: 'rod', length: rodLength };
    }

    static appendVisualPlaceholder(doc, linkEl, type = 'none', options = {}) {
        const visualType = String(type || 'none').toLowerCase();
        if (visualType === 'none' || visualType === 'false') {
            return { added: false, skipped: false, kind: 'none' };
        }

        if (visualType === 'child-marker' || visualType === 'rod') {
            return this.appendRodSegmentVisual(doc, linkEl, options.rodLength);
        }

        const supported = new Set(['box', 'cylinder', 'sphere', 'tcp-marker']);
        if (!supported.has(visualType)) {
            throw new Error(`Unsupported visual placeholder: ${type}`);
        }

        const visualEl = doc.createElement('visual');
        visualEl.setAttribute('name', 'editor_marker_visual');
        const originEl = doc.createElement('origin');
        const markerType = visualType === 'tcp-marker' ? 'sphere' : visualType;
        originEl.setAttribute('xyz', '0 0 0');
        originEl.setAttribute('rpy', markerType === 'cylinder' ? '0 1.57079632679 0' : '0 0 0');

        const geometryEl = doc.createElement('geometry');
        if (markerType === 'box') {
            const boxEl = doc.createElement('box');
            boxEl.setAttribute('size', '0.04 0.04 0.04');
            geometryEl.appendChild(boxEl);
        } else if (markerType === 'cylinder') {
            const cylinderEl = doc.createElement('cylinder');
            cylinderEl.setAttribute('radius', '0.018');
            cylinderEl.setAttribute('length', '0.12');
            geometryEl.appendChild(cylinderEl);
        } else if (markerType === 'sphere') {
            const sphereEl = doc.createElement('sphere');
            sphereEl.setAttribute('radius', '0.012');
            geometryEl.appendChild(sphereEl);
        }

        visualEl.appendChild(originEl);
        visualEl.appendChild(geometryEl);
        this.appendMarkerMaterial(doc, visualEl);
        linkEl.appendChild(visualEl);

        return { added: true, skipped: false, kind: markerType };
    }

    static appendFixedChildLink(doc, robot, parentLinkName, jointName, childLinkName, xyz, rpy, visualPlaceholder = 'none', visualOptions = {}) {
        const linkEl = doc.createElement('link');
        linkEl.setAttribute('name', childLinkName);
        const visualInfo = this.appendVisualPlaceholder(doc, linkEl, visualPlaceholder, visualOptions);

        const jointEl = doc.createElement('joint');
        jointEl.setAttribute('name', jointName);
        jointEl.setAttribute('type', 'fixed');

        const parentEl = doc.createElement('parent');
        parentEl.setAttribute('link', parentLinkName);

        const childEl = doc.createElement('child');
        childEl.setAttribute('link', childLinkName);

        const originEl = doc.createElement('origin');
        originEl.setAttribute('xyz', xyz);
        originEl.setAttribute('rpy', rpy);

        jointEl.appendChild(parentEl);
        jointEl.appendChild(childEl);
        jointEl.appendChild(originEl);

        robot.appendChild(doc.createTextNode('\n  '));
        robot.appendChild(linkEl);
        robot.appendChild(doc.createTextNode('\n  '));
        robot.appendChild(jointEl);
        robot.appendChild(doc.createTextNode('\n'));

        return visualInfo;
    }

    static addFixedChildLink(xmlContent, parentLinkName, options = {}) {
        const { doc, robot } = this.parseURDF(xmlContent);
        const linkNames = this.getExistingLinkNames(doc);
        const jointNames = this.getExistingJointNames(doc);
        const jointName = String(options.jointName || '').trim();
        const childLinkName = String(options.linkName || '').trim();

        if (!linkNames.has(parentLinkName)) {
            throw new Error(`Parent link not found in URDF: ${parentLinkName}`);
        }
        if (!jointName) {
            throw new Error('Joint name is required.');
        }
        if (jointNames.has(jointName)) {
            throw new Error(`Joint already exists: ${jointName}`);
        }
        if (!childLinkName) {
            throw new Error('Child link name is required.');
        }
        if (linkNames.has(childLinkName)) {
            throw new Error(`Link already exists: ${childLinkName}`);
        }

        const xyz = this.assertTriplet(options.xyz || '0 0 0', 'Origin xyz');
        const rpy = this.assertTriplet(options.rpy || '0 0 0', 'Origin rpy');
        const [x, y, z] = this.tripletToNumbers(xyz, 'Origin xyz');
        const rodLength = Math.hypot(x, y, z);
        const addVisualMarker = options.addVisualMarker !== false;
        const visualPlaceholder = addVisualMarker ? (options.visualPlaceholder || 'child-marker') : 'none';

        const visualInfo = this.appendFixedChildLink(
            doc,
            robot,
            parentLinkName,
            jointName,
            childLinkName,
            xyz,
            rpy,
            visualPlaceholder,
            { rodLength }
        );

        return {
            xml: this.serializeFormatted(doc, xmlContent),
            linkName: childLinkName,
            jointName,
            visualInfo
        };
    }

    static addTCPLink(xmlContent, parentLinkName, options = {}) {
        const { doc, robot } = this.parseURDF(xmlContent);
        const linkNames = this.getExistingLinkNames(doc);
        const jointNames = this.getExistingJointNames(doc);

        if (!linkNames.has(parentLinkName)) {
            throw new Error(`Parent link not found in URDF: ${parentLinkName}`);
        }

        const tcpLinkName = this.makeUniqueName(options.linkName || 'tcp_link', linkNames);
        const jointName = this.makeUniqueName(options.jointName || `${parentLinkName}_to_${tcpLinkName}`, jointNames);
        const xyz = this.assertTriplet(options.xyz || '0 0 0', 'TCP xyz');
        const rpy = this.assertTriplet(options.rpy || '0 0 0', 'TCP rpy');
        const addVisualMarker = options.addVisualMarker === true;
        const visualPlaceholder = addVisualMarker ? (options.visualPlaceholder || 'tcp-marker') : 'none';

        const visualInfo = this.appendFixedChildLink(doc, robot, parentLinkName, jointName, tcpLinkName, xyz, rpy, visualPlaceholder);

        return {
            xml: this.serializeFormatted(doc, xmlContent),
            linkName: tcpLinkName,
            jointName,
            visualInfo
        };
    }
}
