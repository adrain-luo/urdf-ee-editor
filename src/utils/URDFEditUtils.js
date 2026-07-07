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

    static appendFixedChildLink(doc, robot, parentLinkName, jointName, childLinkName, xyz, rpy) {
        const linkEl = doc.createElement('link');
        linkEl.setAttribute('name', childLinkName);

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

        this.appendFixedChildLink(doc, robot, parentLinkName, jointName, childLinkName, xyz, rpy);

        return {
            xml: this.serializeFormatted(doc, xmlContent),
            linkName: childLinkName,
            jointName
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

        this.appendFixedChildLink(doc, robot, parentLinkName, jointName, tcpLinkName, xyz, rpy);

        return {
            xml: this.serializeFormatted(doc, xmlContent),
            linkName: tcpLinkName,
            jointName
        };
    }
}
