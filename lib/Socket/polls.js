// lib/Socket/polls.js
import crypto from 'crypto';
import { proto } from '../../WAProto/index.js';
import { getAggregateVotesInPollMessage } from '../Utils/messages.js';

/**
 * Poll creation & voting for ZANTA-BAILEYS
 */

/**
 * Send a poll to a user, group, or channel
 */
export async function sendPoll(sock, jid, pollData) {
    if (!pollData || !pollData.name || !Array.isArray(pollData.values) || pollData.values.length < 2) {
        throw new Error('Poll requires a name (question) and at least 2 option values.');
    }

    const selectableCount = pollData.selectableCount || 1;

    return await sock.sendMessage(jid, {
        poll: {
            name: pollData.name,
            values: pollData.values,
            selectableCount
        }
    });
}

/**
 * Cast a vote on an E2EE poll (chat/group)
 */
export async function sendPollVote(sock, jid, pollKeyOrMsg, selectedOptions) {
    const optionsArray = Array.isArray(selectedOptions) ? selectedOptions : [selectedOptions];
    if (!optionsArray.length) {
        throw new Error('Must specify at least one option to vote for.');
    }

    let pollCreation = null;
    let pollMsgId = null;
    let pollCreatorJid = null;
    let fromMe = false;

    if (pollKeyOrMsg?.message) {
        pollCreation = pollKeyOrMsg.message.pollCreationMessage || 
                       pollKeyOrMsg.message.pollCreationMessageV2 || 
                       pollKeyOrMsg.message.pollCreationMessageV3;
        pollMsgId = pollKeyOrMsg.key?.id;
        pollCreatorJid = pollKeyOrMsg.key?.participant || pollKeyOrMsg.key?.remoteJid;
        fromMe = pollKeyOrMsg.key?.fromMe || false;
    } else if (pollKeyOrMsg?.id) {
        pollMsgId = pollKeyOrMsg.id;
        pollCreatorJid = pollKeyOrMsg.participant || pollKeyOrMsg.remoteJid;
        fromMe = pollKeyOrMsg.fromMe || false;
    }

    if (!pollMsgId) {
        throw new Error('Invalid poll key or message provided.');
    }

    const voterJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    const selectedOptionHashes = optionsArray.map(opt => 
        crypto.createHash('sha256').update(opt).digest()
    );

    let encPayload = null;
    let encIv = null;

    if (pollCreation && pollCreation.encKey) {
        const sign = Buffer.concat([
            Buffer.from(pollMsgId),
            Buffer.from(pollCreatorJid || jid),
            Buffer.from(voterJid),
            Buffer.from('Poll Vote'),
            new Uint8Array([1])
        ]);
        const key0 = crypto.createHmac('sha256', new Uint8Array(32)).update(pollCreation.encKey).digest();
        const encKey = crypto.createHmac('sha256', key0).update(sign).digest();
        const aad = Buffer.from(`${pollMsgId}\u0000${voterJid}`);
        encIv = crypto.randomBytes(12);

        const voteMsgBytes = proto.Message.PollVoteMessage.encode({
            selectedOptions: selectedOptionHashes
        }).finish();

        const cipher = crypto.createCipheriv('aes-256-gcm', encKey, encIv);
        cipher.setAAD(aad);
        const ct = cipher.update(voteMsgBytes);
        const final = cipher.final();
        const tag = cipher.getAuthTag();
        encPayload = Buffer.concat([ct, final, tag]);
    }

    const pollUpdateMessage = {
        pollCreationMessageKey: {
            remoteJid: jid,
            id: pollMsgId,
            fromMe,
            participant: pollCreatorJid
        },
        vote: encPayload ? { encPayload, encIv } : undefined,
        senderTimestampMs: Date.now()
    };

    const relayRes = await sock.relayMessage(jid, { pollUpdateMessage }, {});
    return {
        success: true,
        type: 'e2ee',
        pollMsgId,
        votedOptions: optionsArray,
        relayResult: relayRes
    };
}

/**
 * Get aggregate vote counts from a poll message
 */
export function getAggregatePollVotes(sock, pollMessage) {
    if (!pollMessage) return [];
    return getAggregateVotesInPollMessage(pollMessage, sock.user?.id);
}
