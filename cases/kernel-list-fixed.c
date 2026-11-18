#include <stdlib.h>
#include <stddef.h>

extern int __VERIFIER_nondet_int(void);

/* a minimal copy of <linux/list.h> */
struct list_head {
    struct list_head *next, *prev;
};

#define LIST_HEAD(name) struct list_head name = { &(name), &(name) }

#define container_of(ptr, type, member) \
    ((type *)((char *)(ptr) - offsetof(type, member)))

#define list_entry(ptr, type, member) container_of(ptr, type, member)

#define list_for_each_entry(pos, head, member)                          \
    for (pos = list_entry((head)->next, typeof(*pos), member);          \
         &pos->member != (head);                                        \
         pos = list_entry(pos->member.next, typeof(*pos), member))

#define list_for_each_entry_safe(pos, n, head, member)                  \
    for (pos = list_entry((head)->next, typeof(*pos), member),          \
         n = list_entry(pos->member.next, typeof(*pos), member);        \
         &pos->member != (head);                                        \
         pos = n, n = list_entry(n->member.next, typeof(*n), member))

static void list_add(struct list_head *new, struct list_head *head)
{
    struct list_head *next = head->next;
    next->prev = new;
    new->next = next;
    new->prev = head;
    head->next = new;
}

static void list_del(struct list_head *entry)
{
    entry->next->prev = entry->prev;
    entry->prev->next = entry->next;
}

/* the payload sits around the list_head, not at its start */
struct device {
    int id;
    struct list_head link;
    char name[16];
};

static LIST_HEAD(devices);

int main(void)
{
    while (__VERIFIER_nondet_int()) {
        struct device *dev = malloc(sizeof *dev);
        if (!dev)
            abort();
        dev->id = 0;
        list_add(&dev->link, &devices);
    }

    struct device *dev, *tmp;
    list_for_each_entry_safe(dev, tmp, &devices, link) {
        list_del(&dev->link);
        free(dev);
    }
    return 0;
}
