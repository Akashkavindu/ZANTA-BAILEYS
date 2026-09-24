// lib/Socket/channel-vote.js
import crypto from 'crypto';
import { proto } from '../../WAProto/index.js';
import { getBinaryNodeChild, getBinaryNodeChildren } from '../WABinary/index.js';

/**
 * Channel (Newsletter) Poll Voting for ZANTA-BAILEYS
 */

/**
 * Cast a vote on a WhatsApp channel poll (low-level)
 */
export async function newsletterVoteMessage(sock, jid, serverId, option) {
    const sId = serverId.toString();
    const optionText = option || 'TEST';
    const optionHash = crypto.createHash('sha256').update(optionText).digest();
    const optionHashHex = optionHash.toString('hex');

    const channelPollUpdateMsg = {
        pollUpdateMessage: {
            pollCreationMessageKey: {
                remoteJid: jid,
                id: sId,
                fromMe: false
            },
            senderTimestampMs: Date.now()
        }
    };

    const relayResult = await sock.relayMessage(jid, channelPollUpdateMsg, {
        additionalAttributes: {
            server_id: sId
        }
    });

    // Also query standard stanza
    try {
        await sock.query({
            tag: 'message',
            attrs: {
                to: jid,
                type: 'poll',
                server_id: sId,
                id: sock.generateMessageTag()
            },
            content: [
                {
                    tag: 'poll_vote',
                    attrs: { option: optionHashHex }
                }
            ]
        }).catch(() => {});
    } catch (e) {}

    return {
        success: true,
        channelJid: jid,
        serverId: sId,
        option: optionText,
        optionHashHex,
        relayResult
    };
}

/**
 * Fetch and decode clean messages from a WhatsApp Channel
 */
export async function newsletterGetMessages(sock, jid, count = 20, since = undefined, after = undefined) {
    const rawUpdates = await sock.newsletterFetchMessages(jid, count, since, after);
    const updatesNode = getBinaryNodeChild(rawUpdates, 'message_updates');
    const messageContainers = getBinaryNodeChildren(updatesNode, 'messages');

    const result = [];
    if (!messageContainers) return result;

    for (const container of messageContainers) {
        const msgNodes = getBinaryNodeChildren(container, 'message');
        for (const m of msgNodes) {
            const serverId = m.attrs?.server_id;
            const messageId = m.attrs?.id;
            const timestamp = m.attrs?.time ? parseInt(m.attrs.time, 10) : null;

            const viewsNode = getBinaryNodeChild(m, 'views_count');
            const viewsCount = viewsNode?.attrs?.count ? parseInt(viewsNode.attrs.count, 10) : 0;

            const reactionsNode = getBinaryNodeChild(m, 'reactions');
            const reactions = [];
            if (reactionsNode) {
                const reactionList = getBinaryNodeChildren(reactionsNode, 'reaction');
                for (const r of reactionList) {
                    reactions.push({
                        emoji: r.attrs?.code,
                        count: parseInt(r.attrs?.count || '0', 10)
                    });
                }
            }

            const votesNode = getBinaryNodeChild(m, 'votes');
            const pollVotes = [];
            if (votesNode) {
                const voteList = getBinaryNodeChildren(votesNode, 'vote');
                for (const v of voteList) {
                    const hashBuffer = v.content;
                    pollVotes.push({
                        count: parseInt(v.attrs?.count || '0', 10),
                        optionHash: Buffer.isBuffer(hashBuffer) ? hashBuffer.toString('hex') : null
                    });
                }
            }

            const pTextNode = getBinaryNodeChild(m, 'plaintext');
            let decodedMessage = null;
            let text = null;
            let mediaType = null;
            let poll = null;

            if (pTextNode && pTextNode.content) {
                try {
                    decodedMessage = proto.Message.decode(pTextNode.content);
                    text = decodedMessage.conversation || 
                           decodedMessage.extendedTextMessage?.text || 
                           decodedMessage.imageMessage?.caption || 
                           decodedMessage.videoMessage?.caption;

                    if (decodedMessage.imageMessage) mediaType = 'image';
                    else if (decodedMessage.videoMessage) mediaType = 'video';
                    else if (decodedMessage.audioMessage) mediaType = 'audio';
                    else if (decodedMessage.documentMessage) mediaType = 'document';

                    const pollMsg = decodedMessage.pollCreationMessage || 
                                    decodedMessage.pollCreationMessageV2 || 
                                    decodedMessage.pollCreationMessageV3;

                    if (pollMsg) {
                        mediaType = 'poll';
                        poll = {
                            name: pollMsg.name,
                            options: (pollMsg.options || []).map(o => ({
                                name: o.optionName,
                                hash: crypto.createHash('sha256').update(o.optionName || '').digest('hex')
                            })),
                            selectableCount: pollMsg.selectableOptionsCount || 1,
                            votes: pollVotes
                        };
                    }
                } catch (e) {}
            }

            result.push({
                serverId,
                messageId,
                timestamp,
                mediaType: mediaType || (pollVotes.length > 0 ? 'poll' : 'text'),
                text,
                poll,
                viewsCount,
                reactions,
                rawProto: decodedMessage
            });
        }
    }

    return result;
}

export async function fetchChannelPollByServerId(sock, jid, serverId) {
    if (!sock) throw new Error('Socket instance is required');
    if (!jid) throw new Error('Channel JID is required');
    if (!serverId) throw new Error('Server ID is required');

    const sId = serverId.toString();

    console.log(`🔍 [fetchChannelPollByServerId] Fetching poll: jid=${jid}, serverId=${sId}`);

    // 🎯 Method 1: Query with specific server_id
    try {
        const response = await sock.query({
            tag: 'iq',
            attrs: {
                id: sock.generateMessageTag(),
                type: 'get',
                xmlns: 'newsletter',
                to: jid
            },
            content: [{
                tag: 'message_updates',
                attrs: {
                    count: '50',
                    server_id: sId
                }
            }]
        });

        console.log('🔍 [Method 1] Response received');

        const result = parsePollFromResponse(response, jid);
        if (result && result.poll) {
            console.log('✅ [Method 1] Poll found!');
            return result;
        }
    } catch (e) {
        console.log('❌ [Method 1] Failed:', e.message);
    }

    // 🎯 Method 2: Query with single message by ID
    try {
        const response = await sock.query({
            tag: 'iq',
            attrs: {
                id: sock.generateMessageTag(),
                type: 'get',
                xmlns: 'newsletter',
                to: jid
            },
            content: [{
                tag: 'message',
                attrs: {
                    server_id: sId
                }
            }]
        });

        console.log('🔍 [Method 2] Response received');

        const result = parsePollFromResponse(response, jid);
        if (result && result.poll) {
            console.log('✅ [Method 2] Poll found!');
            return result;
        }
    } catch (e) {
        console.log('❌ [Method 2] Failed:', e.message);
    }

    // 🎯 Method 3: Fetch general messages and filter
    try {
        const response = await sock.query({
            tag: 'iq',
            attrs: {
                id: sock.generateMessageTag(),
                type: 'get',
                xmlns: 'newsletter',
                to: jid
            },
            content: [{
                tag: 'message_updates',
                attrs: {
                    count: '100'
                }
            }]
        });

        console.log('🔍 [Method 3] Response received');

        // 🎯 Parse all messages and find the one with matching server_id
        const allMessages = parseAllMessagesFromResponse(response);
        console.log(`🔍 [Method 3] Total messages parsed: ${allMessages.length}`);
        
        const targetMsg = allMessages.find(m => m.serverId?.toString() === sId);
        
        if (targetMsg) {
            console.log('✅ [Method 3] Target message found!', {
                serverId: targetMsg.serverId,
                hasPoll: !!targetMsg.poll
            });
            return targetMsg;
        }

        // 🎯 If not found by exact match, try any poll
        const anyPoll = allMessages.find(m => m.poll);
        if (anyPoll) {
            console.log('⚠️ [Method 3] Target not found, returning first available poll');
            return anyPoll;
        }
    } catch (e) {
        console.log('❌ [Method 3] Failed:', e.message);
    }

    throw new Error(`Poll with server ID ${sId} not found in channel`);
}

/**
 * 🎯 Parse poll from IQ response
 */
function parsePollFromResponse(response, jid) {
    try {
        const updatesNode = getBinaryNodeChild(response, 'message_updates');
        if (!updatesNode) return null;

        const messageContainers = getBinaryNodeChildren(updatesNode, 'messages');
        if (!messageContainers || messageContainers.length === 0) return null;

        for (const container of messageContainers) {
            const msgNodes = getBinaryNodeChildren(container, 'message');
            for (const m of msgNodes) {
                const parsed = parseSingleMessage(m);
                if (parsed && parsed.poll) {
                    return parsed;
                }
            }
        }
    } catch (e) {
        console.log('Parse error:', e.message);
    }
    return null;
}

/**
 * 🎯 Parse all messages from IQ response
 */
function parseAllMessagesFromResponse(response) {
    const result = [];
    try {
        const updatesNode = getBinaryNodeChild(response, 'message_updates');
        if (!updatesNode) return result;

        const messageContainers = getBinaryNodeChildren(updatesNode, 'messages');
        if (!messageContainers) return result;

        for (const container of messageContainers) {
            const msgNodes = getBinaryNodeChildren(container, 'message');
            for (const m of msgNodes) {
                const parsed = parseSingleMessage(m);
                if (parsed) result.push(parsed);
            }
        }
    } catch (e) {
        console.log('Parse all error:', e.message);
    }
    return result;
}

/**
 * 🎯 Parse single message node
 */
function parseSingleMessage(m) {
    try {
        const serverId = m.attrs?.server_id;
        const messageId = m.attrs?.id;
        const timestamp = m.attrs?.time ? parseInt(m.attrs.time, 10) : null;

        const pTextNode = getBinaryNodeChild(m, 'plaintext');
        let decodedMessage = null;
        let text = null;
        let mediaType = null;
        let poll = null;

        if (pTextNode && pTextNode.content) {
            decodedMessage = proto.Message.decode(pTextNode.content);
            text = decodedMessage.conversation || 
                   decodedMessage.extendedTextMessage?.text || 
                   decodedMessage.imageMessage?.caption || 
                   decodedMessage.videoMessage?.caption;

            if (decodedMessage.imageMessage) mediaType = 'image';
            else if (decodedMessage.videoMessage) mediaType = 'video';
            else if (decodedMessage.audioMessage) mediaType = 'audio';
            else if (decodedMessage.documentMessage) mediaType = 'document';

            const pollMsg = decodedMessage.pollCreationMessage || 
                            decodedMessage.pollCreationMessageV2 || 
                            decodedMessage.pollCreationMessageV3;

            if (pollMsg) {
                mediaType = 'poll';
                
                // 🎯 Extract poll options
                const options = (pollMsg.options || []).map(o => ({
                    name: o.optionName,
                    hash: crypto.createHash('sha256').update(o.optionName || '').digest('hex')
                }));

                // 🎯 Extract poll votes
                const votesNode = getBinaryNodeChild(m, 'votes');
                const pollVotes = [];
                if (votesNode) {
                    const voteList = getBinaryNodeChildren(votesNode, 'vote');
                    for (const v of voteList) {
                        const hashBuffer = v.content;
                        pollVotes.push({
                            count: parseInt(v.attrs?.count || '0', 10),
                            optionHash: Buffer.isBuffer(hashBuffer) ? hashBuffer.toString('hex') : null
                        });
                    }
                }

                poll = {
                    name: pollMsg.name,
                    options,
                    selectableCount: pollMsg.selectableOptionsCount || 1,
                    votes: pollVotes
                };
            }
        }

        return {
            serverId,
            messageId,
            timestamp,
            mediaType: mediaType || 'text',
            text,
            poll,
            rawProto: decodedMessage
        };
    } catch (e) {
        return null;
    }
}

/**
 * 🎯 SMART Channel Poll Vote
 * Automatically resolves channel links, quoted messages, message IDs, and option indexes.
 * 
 * @example
 * await channelVote(sock, '120363427108046852@newsletter', 1);
 * await channelVote(sock, 'https://whatsapp.com/channel/xxx/123', 'Option A');
 * await channelVote(sock, quotedMessage, 2);
 */
export async function channelVote(sock, target, option, explicitServerId = null) {
    if (!sock) throw new Error('Socket instance is required');
    if (!target) throw new Error('Target (link, JID, or quoted message) is required');
    if (option === undefined || option === null || option === '') {
        throw new Error('Option or option number to vote for is required');
    }

    let jid = null;
    let serverId = explicitServerId ? explicitServerId.toString() : null;
    let pollOptions = null;

    // Case 1: Target is an object (quoted message or contextInfo)
    if (typeof target === 'object') {
        const ctx = target.extendedTextMessage?.contextInfo || target.contextInfo || target;

        if (ctx.forwardedNewsletterMessageInfo?.newsletterJid) {
            jid = ctx.forwardedNewsletterMessageInfo.newsletterJid;
            if (ctx.forwardedNewsletterMessageInfo.serverMessageId) {
                serverId = ctx.forwardedNewsletterMessageInfo.serverMessageId.toString();
            }
        } else if (ctx.remoteJid?.endsWith('@newsletter')) {
            jid = ctx.remoteJid;
        } else if (ctx.participant?.endsWith('@newsletter')) {
            jid = ctx.participant;
        }

        if (!serverId && (ctx.stanzaId || ctx.server_id || ctx.serverId)) {
            serverId = (ctx.server_id || ctx.serverId || ctx.stanzaId).toString();
        }

        const qm = ctx.quotedMessage || target.message;
        const pollMsg = qm?.pollCreationMessage || qm?.pollCreationMessageV2 || qm?.pollCreationMessageV3;
        if (pollMsg?.options?.length) {
            pollOptions = pollMsg.options.map((o) => o.optionName);
        }
    } 
    // Case 2: Target is a string (JID or link)
    else if (typeof target === 'string') {
        const trimmed = target.trim();
        const channelLinkMatch = trimmed.match(/whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)(?:\/(\d+))?/i);
        
        if (channelLinkMatch) {
            const inviteCode = channelLinkMatch[1];
            const urlServerId = channelLinkMatch[2];
            if (urlServerId) serverId = urlServerId;

            try {
                const meta = await sock.newsletterMetadata('invite', inviteCode);
                jid = meta?.id || meta?.jid;
            } catch (err) {
                throw new Error(`Could not resolve channel invite "${inviteCode}": ${err.message}`);
            }
        } else if (trimmed.endsWith('@newsletter')) {
            jid = trimmed;
        }
    }

    if (!jid) {
        throw new Error('Could not determine Channel (Newsletter) JID from target.');
    }

    // 🎯 If serverId or pollOptions missing, fetch recent messages
    if (!serverId || !pollOptions) {
        try {
            const recent = await newsletterGetMessages(sock, jid, 25);
            const targetPoll = serverId
                ? recent.find((m) => m.serverId?.toString() === serverId && (m.mediaType === 'poll' || m.poll)) ||
                  recent.find((m) => m.serverId?.toString() === serverId)
                : recent.find((m) => m.mediaType === 'poll' || m.poll);
            
            if (targetPoll) {
                if (!serverId) serverId = targetPoll.serverId?.toString();
                if (targetPoll.poll?.options?.length) {
                    pollOptions = targetPoll.poll.options.map((o) => o.name);
                }
            }
        } catch {}
    }

    if (!serverId) {
        throw new Error('Could not find poll message server ID in this channel.');
    }

    // 🎯 Map numeric index (1, 2...), single letter (A, B, C...), or match case-insensitively
    let selectedOptionText = String(option).trim();
    if (pollOptions && pollOptions.length > 0) {
        if (/^\d+$/.test(selectedOptionText)) {
            const idx = parseInt(selectedOptionText, 10) - 1;
            if (idx >= 0 && idx < pollOptions.length) {
                selectedOptionText = pollOptions[idx];
            }
        } else if (/^[a-zA-Z]$/.test(selectedOptionText)) {
            const letterIdx = selectedOptionText.toUpperCase().charCodeAt(0) - 65;
            const exactLetterMatch = pollOptions.find((o) => o.trim().toUpperCase() === selectedOptionText.toUpperCase());
            if (exactLetterMatch) {
                selectedOptionText = exactLetterMatch;
            } else if (letterIdx >= 0 && letterIdx < pollOptions.length) {
                selectedOptionText = pollOptions[letterIdx];
            }
        } else {
            const matched = pollOptions.find((o) => o.toLowerCase() === selectedOptionText.toLowerCase());
            if (matched) selectedOptionText = matched;
        }
    }

    // 🎯 Cast the vote!
    const voteResult = await newsletterVoteMessage(sock, jid, serverId, selectedOptionText);
    return {
        ...voteResult,
        channelJid: jid,
        serverId,
        selectedOption: selectedOptionText,
        option: selectedOptionText
    };
}
