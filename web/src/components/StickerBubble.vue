<template>
  <span class="sticker-inline" @click="preview">
    <img :src="src" :alt="alt" class="sticker-img" loading="lazy" />
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  src: string
  alt?: string
}>()

const emit = defineEmits<{
  preview: [src: string]
}>()

function preview() {
  emit('preview', props.src)
}
</script>

<style scoped>
.sticker-inline {
  display: inline-block;
  vertical-align: middle;
  margin: 2px 4px;
  cursor: pointer;
}

.sticker-img {
  width: 100px;
  height: 100px;
  object-fit: contain;
  transition: transform 0.15s ease;
  display: block;
}

.sticker-inline:hover .sticker-img {
  transform: scale(1.15);
}
</style>
