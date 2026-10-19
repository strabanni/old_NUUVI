// Photo batches: the window where a writer gives a supporting-cast character 10 to 100 pictures to
// post by themselves on THE NU, one every few days, until they get a new batch.
import { html, render, api, $, toast, icons, modal, confirmModal, promptModal, uploadImage } from '../lib.js';

// "in 3 days", "in 5 hours", "within the hour"
function untilText(sql) {
  const ms = Date.parse(`${String(sql).replace(' ', 'T')}Z`) - Date.now();
  if (ms < 3600e3) return 'within the hour';
  if (ms < 86400e3) return `in about ${Math.round(ms / 3600e3)} hours`;
  const days = Math.round(ms / 86400e3);
  return `in about ${days} day${days === 1 ? '' : 's'}`;
}

export async function openBatch(c) {
  let info;
  try {
    info = await api(`/api/characters/${c.id}/batch`);
  } catch (err) {
    return toast(err.message);
  }
  const { min, max } = info;
  let batch = info.batch;
  let photos = batch ? batch.photos.map((p) => ({ ...p })) : [];
  let changed = false;

  return modal(
    html`
    <form class="batch-form">
      <h2>${c.name}'s photo batch</h2>
      <p class="hint">Give ${c.name} ${min} to ${max} pictures and they'll post one on THE NU by themselves every few days, going round the set until you give them a new batch. Tap a picture to write its caption; pictures without one get a caption written for them.</p>
      <div id="bt-status" class="batch-status"></div>
      <div class="batch-grid" id="bt-grid"></div>
      <div class="batch-add">
        <button type="button" id="bt-add">${icons.image} Add pictures</button>
        <span class="muted small" id="bt-count"></span>
        <input type="file" id="bt-file" accept="image/*" multiple hidden>
      </div>
      <div class="batch-days">
        <div><label for="bt-min">Shortest gap (days)</label><input id="bt-min" name="minDays" type="number" min="1" max="30" value="${batch?.minDays ?? 3}"></div>
        <div><label for="bt-max">Longest gap (days)</label><input id="bt-max" name="maxDays" type="number" min="1" max="30" value="${batch?.maxDays ?? 7}"></div>
      </div>
      <label class="check"><input type="checkbox" name="paused" ${batch?.paused ? 'checked' : ''}> Pause posting for now</label>
      <p class="hint" id="bt-restart" hidden>Saving makes this a new batch, starting again from the first picture.</p>
      <div class="error"></div>
      <div class="actions spread">
        <span>${batch ? html`<button type="button" class="ghost danger" id="bt-remove">Remove batch</button>` : ''}</span>
        <span><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save</button></span>
      </div>
    </form>`,
    {
      init: (d, close) => {
        const grid = $('#bt-grid', d);
        const drawStatus = () =>
          render(
            $('#bt-status', d),
            batch
              ? html`<p class="small">${icons.hourglass} ${batch.paused ? 'Paused' : `Next picture ${untilText(batch.nextAt)}`} · picture ${batch.nextIndex + 1} of ${batch.photos.length} · ${batch.posted} posted so far
                  ${batch.paused ? '' : html`<button type="button" class="ghost small-btn" id="bt-now">Post the next one now</button>`}</p>`
              : html`<p class="small muted">No batch yet.</p>`,
          );
        const draw = () => {
          render(
            grid,
            html`${photos.map(
              (p, i) => html`
            <div class="batch-item ${batch && !changed && i === batch.nextIndex ? 'next' : ''}">
              <button type="button" class="batch-pic" data-cap="${i}" aria-label="Caption for picture ${i + 1}" title="${p.caption || 'No caption yet'}">
                <img src="${p.url}" alt="" loading="lazy">${p.caption ? html`<span class="batch-has-cap">${icons.quill}</span>` : ''}
              </button>
              <button type="button" class="batch-x" data-drop="${i}" aria-label="Remove picture ${i + 1}">✕</button>
            </div>`,
            )}`,
          );
          const n = photos.length;
          $('#bt-count', d).textContent = `${n} of ${max}${n < min ? ` · add ${min - n} more` : ''}`;
          $('#bt-add', d).disabled = n >= max;
          $('#bt-restart', d).hidden = !(batch && changed);
        };
        drawStatus();
        draw();
        grid.addEventListener('click', async (e) => {
          const drop = e.target.closest('[data-drop]');
          if (drop) {
            photos.splice(Number(drop.dataset.drop), 1);
            changed = true;
            return draw();
          }
          const cap = e.target.closest('[data-cap]');
          if (!cap) return;
          const p = photos[Number(cap.dataset.cap)];
          const text = await promptModal('Caption', {
            value: p.caption,
            multiline: true,
            maxlength: 2000,
            required: false,
            placeholder: 'Leave empty to have one written',
          });
          if (text === null) return;
          p.caption = text.trim();
          changed = true;
          draw();
        });
        const file = $('#bt-file', d);
        $('#bt-add', d).addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
          const files = [...file.files].slice(0, max - photos.length);
          file.value = '';
          const add = $('#bt-add', d);
          add.disabled = true;
          let failed = 0;
          for (const [i, f] of files.entries()) {
            add.textContent = `Uploading ${i + 1} of ${files.length}…`;
            try {
              photos.push({ url: await uploadImage(f, 1600), caption: '' });
              changed = true;
            } catch {
              failed += 1;
            }
            draw();
          }
          render(add, html`${icons.image} Add pictures`);
          draw();
          if (failed) toast(`${failed} picture${failed === 1 ? '' : 's'} couldn't be uploaded`);
        });
        d.addEventListener('click', async (e) => {
          if (e.target.closest('#bt-now')) {
            try {
              ({ batch } = await api(`/api/characters/${c.id}/batch/post`, { method: 'POST', body: {} }));
              toast(`${c.name} posted a picture`);
              drawStatus();
              if (!changed) draw();
            } catch (err) {
              toast(err.message);
            }
          }
          if (e.target.closest('#bt-remove')) {
            if (
              !(await confirmModal(`Remove ${c.name}'s photo batch? Pictures already posted stay up.`, {
                ok: 'Remove',
                danger: true,
              }))
            )
              return;
            await api(`/api/characters/${c.id}/batch`, { method: 'DELETE' });
            toast('Batch removed');
            close(true);
          }
        });
      },
      submit: async (data) => {
        const body = { minDays: Number(data.minDays), maxDays: Number(data.maxDays), paused: !!data.paused };
        if (changed || !batch) {
          if (photos.length < min) throw new Error(`Add at least ${min} pictures (you have ${photos.length})`);
          body.photos = photos;
        }
        await api(`/api/characters/${c.id}/batch`, { method: 'PUT', body });
        toast(body.photos ? `${c.name}'s first picture goes up within the hour` : 'Saved');
        return true;
      },
    },
  );
}
