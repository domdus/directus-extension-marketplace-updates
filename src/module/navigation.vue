<template>
	<v-list nav>
		<v-list-item to="/settings/marketplace">
			<v-list-item-icon>
				<v-icon name="storefront" />
			</v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Marketplace" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/settings/extensions">
			<v-list-item-icon>
				<v-icon name="category" />
			</v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Extensions" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/extension-updates">
			<v-list-item-icon>
				<v-icon name="system_update" />
			</v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Extension Updates" />
			</v-list-item-content>
		</v-list-item>
	</v-list>
</template>

<script setup lang="ts">
</script>
